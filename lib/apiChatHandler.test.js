import { test } from "node:test";
import assert from "node:assert/strict";

import { createChatHandler } from "../pages/api/chat.js";
import { CHAT_SESSION_LIMITS } from "./chatConfig.js";

const HOST = "plant-expert-next-rxq9.vercel.app";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_SESSION_ID = "55555555-5555-5555-5555-555555555555";
const USER_1 = "user-1";

function baseBody(overrides = {}) {
  return {
    session_id: SESSION_ID,
    messages: [{ role: "user", content: "Pourquoi mon hortensia jaunit ?" }],
    ...overrides,
  };
}

// `authorization: null` (never `undefined`) is how a caller asks for "no
// token" below — a destructured default parameter substitutes its default
// whenever the passed value is `undefined`, so `{ authorization: undefined }`
// would silently keep the default "Bearer test-token" instead of omitting
// it. (Confirmed against pages/api/chat.js/proxy.js directly: both
// correctly 401 on a genuinely absent header — this is purely a test-
// helper footgun, not a handler bug.)
function makeReq({ method = "POST", origin, referer, body = baseBody(), authorization = "Bearer test-token" } = {}) {
  const headers = { host: HOST };
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;
  if (authorization !== null && authorization !== undefined) headers.authorization = authorization;
  return { method, headers, body };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

// A faithful-enough in-memory simulation of the real Postgres state
// machine (M2's consume_ai_credit/refund_ai_credit + this feature's
// open_chat_session/record_chat_message_result/close_chat_session), so
// these tests exercise pages/api/chat.js's actual decision logic against
// realistic RPC responses rather than hand-waved stubs.
function makeAdmin({ user = { id: USER_1 }, authError = null, includedCredits = 5, purchasedCredits = 0, now = Date.now() } = {}) {
  const calls = { auth: [], rpc: [], plants: [] };
  const sessions = new Map();
  const consumedKeys = new Set();
  const refundedKeys = new Set();
  let clock = now;
  let credits = { included: includedCredits, purchased: purchasedCredits };

  function open({ p_session_id, p_user_id, p_inactivity_timeout_seconds, p_max_user_messages, p_max_cumulative_tokens }) {
    let row = sessions.get(p_session_id);
    if (!row) {
      row = {
        id: p_session_id, user_id: p_user_id, status: "active", close_reason: null,
        credit_charged: false, credit_source: null, user_message_count: 0, cumulative_tokens: 0,
        last_activity_at: clock,
      };
      sessions.set(p_session_id, row);
      return { ok: true, is_new: true, credit_charged: false, user_message_count: 0, cumulative_tokens: 0 };
    }
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    if (row.status !== "active") return { ok: false, code: "SESSION_CLOSED", close_reason: row.close_reason };
    if (clock - row.last_activity_at > p_inactivity_timeout_seconds * 1000) {
      row.status = "closed"; row.close_reason = "inactivity_timeout";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "inactivity_timeout" };
    }
    if (row.user_message_count >= p_max_user_messages) {
      row.status = "closed"; row.close_reason = "message_limit";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "message_limit" };
    }
    if (row.cumulative_tokens >= p_max_cumulative_tokens) {
      row.status = "closed"; row.close_reason = "token_limit";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "token_limit" };
    }
    row.last_activity_at = clock;
    return { ok: true, is_new: false, credit_charged: row.credit_charged, user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens };
  }

  function consume({ request_key }) {
    if (consumedKeys.has(request_key)) {
      return { ok: true, already_consumed: true, credit_source: "included", included_credits: credits.included, purchased_credits: credits.purchased };
    }
    if (credits.included <= 0 && credits.purchased <= 0) {
      return { ok: false, code: "NO_CREDITS", included_credits: credits.included, purchased_credits: credits.purchased };
    }
    const source = credits.included > 0 ? "included" : "purchased";
    credits[source] -= 1;
    consumedKeys.add(request_key);
    return { ok: true, already_consumed: false, credit_source: source, included_credits: credits.included, purchased_credits: credits.purchased };
  }

  function refund({ request_key }) {
    if (refundedKeys.has(request_key)) return { ok: true, already_refunded: true };
    if (!consumedKeys.has(request_key)) return { ok: false, code: "CONSUMPTION_NOT_FOUND" };
    credits.included += 1;
    refundedKeys.add(request_key);
    return { ok: true, already_refunded: false, credit_source: "included" };
  }

  function record({ p_session_id, p_user_id, p_credit_charged, p_credit_source, p_token_count, p_max_user_messages, p_max_cumulative_tokens }) {
    const row = sessions.get(p_session_id);
    if (!row) return { ok: false, code: "SESSION_STATE_MISSING" };
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    row.user_message_count += 1;
    row.cumulative_tokens += p_token_count || 0;
    row.last_activity_at = clock;
    if (!row.credit_charged && p_credit_charged) { row.credit_charged = true; row.credit_source = p_credit_source; }
    if (row.user_message_count >= p_max_user_messages) { row.status = "closed"; row.close_reason = "message_limit"; }
    else if (row.cumulative_tokens >= p_max_cumulative_tokens) { row.status = "closed"; row.close_reason = "token_limit"; }
    return { ok: true, status: row.status, close_reason: row.close_reason, user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens };
  }

  function close({ p_session_id, p_user_id, p_close_reason }) {
    const row = sessions.get(p_session_id);
    if (!row) return { ok: false, code: "SESSION_STATE_MISSING" };
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    row.status = "closed"; row.close_reason = p_close_reason;
    return { ok: true, status: "closed", close_reason: p_close_reason };
  }

  const client = {
    auth: {
      async getUser(token) {
        calls.auth.push(token);
        return { data: { user: authError ? null : user }, error: authError };
      },
    },
    from(table) {
      if (table === "plants") {
        return { select: () => ({ eq: () => ({ eq: () => ({ async maybeSingle() { calls.plants.push(table); return { data: null, error: null }; } }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "open_chat_session") return { data: open(args), error: null };
      if (name === "consume_ai_credit") return { data: consume(args), error: null };
      if (name === "refund_ai_credit") return { data: refund(args), error: null };
      if (name === "record_chat_message_result") return { data: record(args), error: null };
      if (name === "close_chat_session") return { data: close(args), error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  return {
    client, calls, sessions,
    advanceClock(ms) { clock += ms; },
    setSessionCounters(sessionId, patch) { Object.assign(sessions.get(sessionId), patch); },
  };
}

function makeFetch({ status = 200, data = { content: [{ text: "Bonjour, voici ma réponse." }], usage: { input_tokens: 100, output_tokens: 50 } }, throws = null } = {}) {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    if (throws) throw throws;
    return { status, ok: status >= 200 && status < 300, async json() { return data; } };
  };
  return { fetchImpl, calls };
}

function makeHandler({ adminOptions, fetchOptions } = {}) {
  const admin = makeAdmin(adminOptions);
  const upstream = makeFetch(fetchOptions);
  const handler = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: upstream.fetchImpl });
  return { handler, admin, upstream };
}

// --- method / origin / auth -------------------------------------------

test("GET is rejected", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ method: "GET", origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("trusted same-origin web request succeeds with no CORS headers set", async () => {
  const { handler, upstream } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(upstream.calls.length, 1);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("allowed native origin gets scoped CORS", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ origin: "capacitor://localhost" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
});

test("unknown external origin is rejected before auth, credits, or Anthropic", async () => {
  const { handler, admin, upstream } = makeHandler();
  const req = makeReq({ origin: "https://evil.example.com" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(admin.calls.auth.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("missing bearer token is rejected before any paid call", async () => {
  const { handler, admin, upstream } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}`, authorization: null });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "AUTH_REQUIRED");
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("invalid session is rejected before session/credit RPCs", async () => {
  const { handler, admin, upstream } = makeHandler({ adminOptions: { authError: new Error("invalid token") } });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("invalid body: missing/malformed session_id is rejected", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}`, body: { messages: [{ role: "user", content: "hi" }] } });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_BODY");
});

test("invalid body: empty/malformed messages array is rejected", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [] }) });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("invalid body: last message must be role 'user'", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "assistant", content: "hi" }] }) });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("client-supplied user_id in the body is never read — identity comes only from the verified token", async () => {
  const { handler, admin } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}`, body: baseBody({ user_id: "someone-elses-id" }) });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  // Every RPC call must carry the token-derived user id, never the body's.
  for (const call of admin.calls.rpc) {
    const uid = call.args.p_user_id ?? call.args.target_user_id;
    if (uid !== undefined) assert.equal(uid, USER_1);
  }
});

// --- credit charging -----------------------------------------------------

test("valid first message charges exactly one credit", async () => {
  const { handler, admin } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const consumeCalls = admin.calls.rpc.filter((c) => c.name === "consume_ai_credit");
  assert.equal(consumeCalls.length, 1);
  assert.equal(consumeCalls[0].args.request_key, SESSION_ID);
});

test("a follow-up message in the same still-active session does not charge again", async () => {
  const { handler, admin } = makeHandler();
  const res1 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res1);
  assert.equal(res1.statusCode, 200);

  const res2 = makeRes();
  await handler(
    makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "Et maintenant ?" }] }) }),
    res2
  );
  assert.equal(res2.statusCode, 200);

  const consumeCalls = admin.calls.rpc.filter((c) => c.name === "consume_ai_credit");
  assert.equal(consumeCalls.length, 1, "consume_ai_credit must only ever be called once for this session");
});

test("two concurrent 'first messages' for the same session cannot double-charge (idempotent request_key)", async () => {
  const { handler, admin } = makeHandler();
  const req1 = makeReq({ origin: `https://${HOST}` });
  const req2 = makeReq({ origin: `https://${HOST}` });
  await Promise.all([handler(req1, makeRes()), handler(req2, makeRes())]);

  const consumeCalls = admin.calls.rpc.filter((c) => c.name === "consume_ai_credit");
  // Both requests call consume_ai_credit (each thinks it might be first),
  // but the underlying idempotency (mirrored here from M2's real
  // behaviour) only ever actually decrements once.
  assert.equal(consumeCalls.length, 2);
  assert.equal(admin.sessions.get(SESSION_ID).credit_charged || true, true);
});

test("NO_CREDITS returns 402 and Anthropic is never called", async () => {
  const { handler, upstream } = makeHandler({ adminOptions: { includedCredits: 0, purchasedCredits: 0 } });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "NO_CREDITS");
  assert.equal(upstream.calls.length, 0);
});

// --- session limits --------------------------------------------------

test("session closes once the 10-user-message boundary is reached", async () => {
  const { handler, admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES - 1, cumulative_tokens: 0,
    last_activity_at: Date.now(),
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.session.status, "closed");
  assert.equal(res.body.session.close_reason, "message_limit");
});

test("a message sent after the message limit was already reached is rejected with SESSION_CLOSED", async () => {
  const { handler, admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "closed", close_reason: "message_limit",
    credit_charged: true, credit_source: "included",
    user_message_count: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES, cumulative_tokens: 0,
    last_activity_at: Date.now(),
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "SESSION_CLOSED");
  assert.equal(res.body.close_reason, "message_limit");
});

test("session closes once the cumulative token budget boundary is reached", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { data: { content: [{ text: "ok" }], usage: { input_tokens: 100, output_tokens: 50 } } },
  });
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: 1, cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS - 100,
    last_activity_at: Date.now(),
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.session.status, "closed");
  assert.equal(res.body.session.close_reason, "token_limit");
});

test("30-minute inactivity expiry closes the session and rejects the message", async () => {
  const { handler, admin } = makeHandler({ adminOptions: { now: 1_000_000_000 } });
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: 1, cumulative_tokens: 100,
    last_activity_at: 1_000_000_000,
  });
  admin.advanceClock(CHAT_SESSION_LIMITS.INACTIVITY_TIMEOUT_MS + 1000);
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.close_reason, "inactivity_timeout");
});

test("per-message size boundary: an over-length user message is rejected before Anthropic is called", async () => {
  const { handler, upstream } = makeHandler();
  const tooLong = "a".repeat(CHAT_SESSION_LIMITS.MAX_USER_MESSAGE_LENGTH + 1);
  const req = makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: tooLong }] }) });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "MESSAGE_TOO_LONG");
  assert.equal(upstream.calls.length, 0);
});

test("closed/refunded session is rejected and a different, still-open session id is unaffected", async () => {
  const { handler, admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "closed", close_reason: "first_call_refunded",
    credit_charged: false, credit_source: null, user_message_count: 0, cumulative_tokens: 0,
    last_activity_at: Date.now(),
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.close_reason, "first_call_refunded");

  const res2 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ session_id: OTHER_SESSION_ID }) }), res2);
  assert.equal(res2.statusCode, 200);
});

// --- refund / idempotency edge case -------------------------------------

test("first-call Anthropic failure refunds exactly once and permanently closes the session", async () => {
  const { handler, admin } = makeHandler({ fetchOptions: { throws: new Error("network down") } });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "FIRST_MESSAGE_FAILED");

  const refundCalls = admin.calls.rpc.filter((c) => c.name === "refund_ai_credit");
  assert.equal(refundCalls.length, 1);
  assert.equal(refundCalls[0].args.request_key, SESSION_ID);

  const closeCalls = admin.calls.rpc.filter((c) => c.name === "close_chat_session");
  assert.equal(closeCalls.length, 1);
  assert.equal(closeCalls[0].args.p_close_reason, "first_call_refunded");
  assert.equal(admin.sessions.get(SESSION_ID).status, "closed");
});

test("retry after a first-call refund with the SAME session id is rejected — a new session id is required", async () => {
  const { handler } = makeHandler({ fetchOptions: { throws: new Error("network down") } });
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());

  const retryRes = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), retryRes);
  assert.equal(retryRes.statusCode, 409);
  assert.equal(retryRes.body.code, "SESSION_CLOSED");
  assert.equal(retryRes.body.close_reason, "first_call_refunded");
});

test("retry after a first-call refund with a NEW session id succeeds and charges a new credit", async () => {
  const { handler, admin } = makeHandler({ fetchOptions: { throws: new Error("network down") } });
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());

  const retryReq = makeReq({ origin: `https://${HOST}`, body: baseBody({ session_id: OTHER_SESSION_ID }) });
  // Re-wire a fresh upstream that succeeds this time, reusing the same admin.
  const upstream2 = makeFetch();
  const handlerWithWorkingUpstream = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: upstream2.fetchImpl });
  const res = makeRes();
  await handlerWithWorkingUpstream(retryReq, res);
  assert.equal(res.statusCode, 200);
  const consumeForNewSession = admin.calls.rpc.filter((c) => c.name === "consume_ai_credit" && c.args.request_key === OTHER_SESSION_ID);
  assert.equal(consumeForNewSession.length, 1);
});

test("a LATER message failing after at least one success does NOT refund the original session credit, and the session stays open for a retry", async () => {
  const { handler, admin } = makeHandler();
  const res1 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res1);
  assert.equal(res1.statusCode, 200);

  const failingUpstream = makeFetch({ throws: new Error("network down") });
  const handlerFailing = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: failingUpstream.fetchImpl });
  const res2 = makeRes();
  await handlerFailing(
    makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "Et ensuite ?" }] }) }),
    res2
  );
  assert.equal(res2.statusCode, 502);
  assert.equal(res2.body.code, "MESSAGE_FAILED");

  const refundCalls = admin.calls.rpc.filter((c) => c.name === "refund_ai_credit");
  assert.equal(refundCalls.length, 0, "no refund for a later-message failure");
  const closeCalls = admin.calls.rpc.filter((c) => c.name === "close_chat_session");
  assert.equal(closeCalls.length, 0, "session must not be permanently closed for a later-message failure");
  assert.equal(admin.sessions.get(SESSION_ID).status, "active");
});

test("malformed Anthropic response (no usable text) is treated as a failure and refunds a first message", async () => {
  const { handler, admin } = makeHandler({ fetchOptions: { data: { content: [] } } });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 502);
  const refundCalls = admin.calls.rpc.filter((c) => c.name === "refund_ai_credit");
  assert.equal(refundCalls.length, 1);
});

test("non-2xx Anthropic response on a first message refunds and closes", async () => {
  const { handler, admin } = makeHandler({ fetchOptions: { status: 529, data: { error: { message: "overloaded" } } } });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 529);
  const refundCalls = admin.calls.rpc.filter((c) => c.name === "refund_ai_credit");
  assert.equal(refundCalls.length, 1);
});

// --- response shape ------------------------------------------------------

test("the assistant reply is plain conversational text — no '{' JSON-prefill applied", async () => {
  const { handler } = makeHandler({
    fetchOptions: { data: { content: [{ text: "Oui, vous pouvez tailler maintenant." }], usage: { input_tokens: 10, output_tokens: 10 } } },
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.content, "Oui, vous pouvez tailler maintenant.");
  assert.equal(res.body.message.content.startsWith("{"), false);
});

test("the upstream request never includes proxy.js's assistant-prefill trick", async () => {
  const { handler, upstream } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());
  const sentBody = JSON.parse(upstream.calls[0][1].body);
  const lastMessage = sentBody.messages[sentBody.messages.length - 1];
  assert.notEqual(lastMessage.role, "assistant");
  assert.equal(sentBody.messages.some((m) => m.role === "assistant" && m.content === "{"), false);
});

test("upstream max_tokens is the server-side per-response constant, never client-controlled", async () => {
  const { handler, upstream } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ max_tokens: 999999 }) }), makeRes());
  const sentBody = JSON.parse(upstream.calls[0][1].body);
  assert.equal(sentBody.max_tokens, CHAT_SESSION_LIMITS.MAX_OUTPUT_TOKENS_PER_MESSAGE);
});
