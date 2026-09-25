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
// machine: M2's consume_ai_credit/refund_ai_credit (unchanged), plus this
// revision's reserve_chat_message / reconcile_chat_message /
// release_chat_message_reservation / close_chat_session. Each function
// below mirrors the SQL function of the same name field-for-field,
// including the row-lock-equivalent atomicity a single JS function call
// gives us here (each is one synchronous, uninterruptible step, same as
// one Postgres transaction under `for update`).
function makeAdmin({ user = { id: USER_1 }, authError = null, includedCredits = 5, purchasedCredits = 0, now = Date.now() } = {}) {
  const calls = { auth: [], rpc: [], plants: [], usage: [] };
  const sessions = new Map();
  const consumedKeys = new Set();
  const refundedKeys = new Set();
  let clock = now;
  let credits = { included: includedCredits, purchased: purchasedCredits };
  let reservationCounter = 0;

  function newSessionRow(id, userId) {
    return {
      id, user_id: userId, status: "active", close_reason: null,
      credit_charged: false, credit_source: null, user_message_count: 0, cumulative_tokens: 0,
      last_activity_at: clock,
      last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
    };
  }

  function reserve({ p_session_id, p_user_id, p_inactivity_timeout_seconds, p_max_user_messages, p_max_cumulative_tokens, p_estimated_tokens }) {
    let row = sessions.get(p_session_id);
    if (!row) {
      row = newSessionRow(p_session_id, p_user_id);
      sessions.set(p_session_id, row);
    }
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    if (row.status !== "active") return { ok: false, code: "SESSION_CLOSED", close_reason: row.close_reason };
    if (clock - row.last_activity_at > p_inactivity_timeout_seconds * 1000) {
      row.status = "closed"; row.close_reason = "inactivity_timeout";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "inactivity_timeout" };
    }
    // Atomic check-and-reserve: this whole function call is the
    // equivalent of one locked transaction, so two "concurrent" calls in
    // a test (invoked back-to-back, or via Promise.all against this
    // synchronous core) can never both observe the pre-increment count.
    if (row.user_message_count >= p_max_user_messages) {
      row.status = "closed"; row.close_reason = "message_limit";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "message_limit" };
    }
    if (row.cumulative_tokens + (p_estimated_tokens || 0) > p_max_cumulative_tokens) {
      row.status = "closed"; row.close_reason = "token_limit";
      return { ok: false, code: "SESSION_CLOSED", close_reason: "token_limit" };
    }
    const reservationId = `reservation-${++reservationCounter}`;
    row.user_message_count += 1;
    row.cumulative_tokens += p_estimated_tokens || 0;
    row.last_activity_at = clock;
    row.last_reservation_id = reservationId;
    row.last_reservation_estimated_tokens = p_estimated_tokens || 0;
    row.last_reservation_finalized = false;
    return {
      ok: true, reservation_id: reservationId, credit_charged: row.credit_charged,
      user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens,
    };
  }

  function reconcile({ p_session_id, p_user_id, p_reservation_id, p_actual_tokens, p_credit_charged, p_credit_source, p_max_user_messages, p_max_cumulative_tokens }) {
    const row = sessions.get(p_session_id);
    if (!row) return { ok: false, code: "SESSION_STATE_MISSING" };
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    if (row.last_reservation_id !== p_reservation_id) return { ok: false, code: "RESERVATION_MISMATCH" };
    if (row.last_reservation_finalized) {
      return {
        ok: true, already_reconciled: true, status: row.status, close_reason: row.close_reason,
        user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens,
      };
    }
    let newCumulative = row.cumulative_tokens - (row.last_reservation_estimated_tokens || 0) + (p_actual_tokens || 0);
    if (newCumulative < 0) newCumulative = 0;
    let nextStatus = "active";
    let nextCloseReason = null;
    if (row.user_message_count >= p_max_user_messages) {
      nextStatus = "closed"; nextCloseReason = "message_limit";
    } else if (newCumulative >= p_max_cumulative_tokens) {
      nextStatus = "closed"; nextCloseReason = "token_limit";
    }
    row.cumulative_tokens = newCumulative;
    row.last_activity_at = clock;
    if (!row.credit_charged && p_credit_charged) {
      row.credit_charged = true;
      row.credit_source = p_credit_source;
    }
    row.last_reservation_finalized = true;
    row.status = nextStatus;
    row.close_reason = nextCloseReason;
    return {
      ok: true, already_reconciled: false, status: row.status, close_reason: row.close_reason,
      user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens,
    };
  }

  function release({ p_session_id, p_user_id, p_reservation_id }) {
    const row = sessions.get(p_session_id);
    if (!row) return { ok: false, code: "SESSION_STATE_MISSING" };
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    if (row.last_reservation_id !== p_reservation_id) return { ok: false, code: "RESERVATION_MISMATCH" };
    if (row.last_reservation_finalized) {
      return { ok: true, already_finalized: true, user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens };
    }
    row.user_message_count = Math.max(row.user_message_count - 1, 0);
    row.cumulative_tokens = Math.max(row.cumulative_tokens - (row.last_reservation_estimated_tokens || 0), 0);
    row.last_reservation_finalized = true;
    return { ok: true, already_finalized: false, user_message_count: row.user_message_count, cumulative_tokens: row.cumulative_tokens };
  }

  function close({ p_session_id, p_user_id, p_close_reason }) {
    const row = sessions.get(p_session_id);
    if (!row) return { ok: false, code: "SESSION_STATE_MISSING" };
    if (row.user_id !== p_user_id) return { ok: false, code: "FORBIDDEN" };
    row.status = "closed"; row.close_reason = p_close_reason;
    return { ok: true, status: "closed", close_reason: p_close_reason };
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

  const client = {
    auth: {
      async getUser(token) {
        calls.auth.push(token);
        return { data: { user: authError ? null : user }, error: authError };
      },
    },
    from(table) {
      if (table === "plants") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ async maybeSingle() { calls.plants.push(table); return { data: null, error: null }; } }),
              // General-mode's list query (.eq("user_id", userId).limit(n)):
              // no plants configured for these full-handler tests — an
              // empty garden must never block/alter the credit/session
              // flow under test here (see chatContext.test.js for the
              // dedicated general-context coverage: cross-user isolation,
              // bounded size, empty-garden degradation, etc.).
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      // General mode's other context sources (garden_zones, plant_reminders,
      // profiles) — always empty here so every existing credit/session test
      // below exercises an authenticated user with no saved garden data,
      // which must degrade safely rather than change any status code.
      if (table === "garden_zones" || table === "plant_reminders") {
        const empty = {
          select: () => empty,
          eq: () => empty,
          in: () => empty,
          lte: () => empty,
          order: () => empty,
          limit: () => empty,
          then(resolve) { resolve({ data: [], error: null }); },
        };
        return empty;
      }
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ async maybeSingle() { return { data: null, error: null }; } }) }) };
      }
      if (table === "ai_chat_usage") {
        return {
          async insert(row) {
            calls.usage.push(row);
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "reserve_chat_message") return { data: reserve(args), error: null };
      if (name === "reconcile_chat_message") return { data: reconcile(args), error: null };
      if (name === "release_chat_message_reservation") return { data: release(args), error: null };
      if (name === "close_chat_session") return { data: close(args), error: null };
      if (name === "consume_ai_credit") return { data: consume(args), error: null };
      if (name === "refund_ai_credit") return { data: refund(args), error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  return {
    client, calls, sessions,
    advanceClock(ms) { clock += ms; },
    setSessionCounters(sessionId, patch) { Object.assign(sessions.get(sessionId), patch); },
    // Directly invoke the RPC cores, bypassing the handler — used to test
    // a specific RPC's own atomicity/idempotency in isolation, without a
    // full request's later steps (Anthropic call + reconcile) obscuring
    // the property under test. reconcile REPLACES a reservation's
    // conservative token estimate with real (usually much smaller) usage,
    // so going through two full handler() calls back-to-back cannot
    // observe the "both reservations still hold their conservative
    // estimate" window a real concurrent race would — reserveDirect lets
    // a test hold that window open deliberately.
    reserveDirect: reserve,
    reconcileDirect: reconcile,
    getCreditsRemaining() { return { ...credits }; },
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
  const { handler, admin } = makeHandler({ adminOptions: { includedCredits: 5 } });
  const req1 = makeReq({ origin: `https://${HOST}` });
  const req2 = makeReq({ origin: `https://${HOST}` });
  await Promise.all([handler(req1, makeRes()), handler(req2, makeRes())]);

  const consumeCalls = admin.calls.rpc.filter((call) => call.name === "consume_ai_credit");
  assert.equal(consumeCalls.length, 2, "both requests attempt to consume — the idempotency lives in the RPC, not in how often it's called");
  // Both requests are genuine messages once credit idempotency resolves
  // (see the reservation tests below for the actual slot-count
  // property), but only ONE credit was ever actually decremented for
  // this session — that's the property under test here.
  assert.equal(admin.getCreditsRemaining().included, 4);
});

test("NO_CREDITS returns 402, releases the reservation, and Anthropic is never called", async () => {
  const { handler, admin, upstream } = makeHandler({ adminOptions: { includedCredits: 0, purchasedCredits: 0 } });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "NO_CREDITS");
  assert.equal(upstream.calls.length, 0);
  // The reservation taken before the credit check must be given back —
  // the session is untouched by this rejected attempt.
  const row = admin.sessions.get(SESSION_ID);
  assert.equal(row.user_message_count, 0);
  assert.equal(row.cumulative_tokens, 0);
  const releaseCalls = admin.calls.rpc.filter((c) => c.name === "release_chat_message_reservation");
  assert.equal(releaseCalls.length, 1);
});

// --- FIX 1: atomic reservation / concurrency -----------------------------

test("two simultaneous first-message attempts for the same session: exactly one message slot is consumed net", async () => {
  const { handler, admin } = makeHandler();
  await Promise.all([
    handler(makeReq({ origin: `https://${HOST}` }), makeRes()),
    handler(makeReq({ origin: `https://${HOST}` }), makeRes()),
  ]);
  // Both requests reserve+reconcile successfully (both are genuine
  // messages once credit idempotency is resolved), so the session
  // legitimately ends with 2 messages recorded — the property under test
  // is that reservation was NEVER skipped/raced, i.e. the count is
  // exactly the number of requests that actually got a slot, never more.
  const row = admin.sessions.get(SESSION_ID);
  assert.equal(row.user_message_count, 2);
});

test("two simultaneous follow-ups in an already-active session both get counted, never lost or duplicated", async () => {
  const { handler, admin } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());
  assert.equal(admin.sessions.get(SESSION_ID).user_message_count, 1);

  await Promise.all([
    handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "a" }] }) }), makeRes()),
    handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "b" }] }) }), makeRes()),
  ]);
  assert.equal(admin.sessions.get(SESSION_ID).user_message_count, 3);
});

test("message 10 vs message 11 concurrently: the session never exceeds 10 user messages", async () => {
  const { handler, admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES - 1, cumulative_tokens: 0,
    last_activity_at: Date.now(),
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
  });

  await Promise.all([
    handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "a" }] }) }), makeRes()),
    handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "b" }] }) }), makeRes()),
  ]);

  const row = admin.sessions.get(SESSION_ID);
  assert.ok(row.user_message_count <= CHAT_SESSION_LIMITS.MAX_USER_MESSAGES, `user_message_count ${row.user_message_count} exceeded the limit`);
  assert.equal(row.user_message_count, CHAT_SESSION_LIMITS.MAX_USER_MESSAGES);
  assert.equal(row.status, "closed");
  assert.equal(row.close_reason, "message_limit");
});

test("token budget reached concurrently: the reservation step itself rejects the second racer using the conservative estimate, before either resolves", async () => {
  // Uses reserveDirect rather than two full handler() calls: a full
  // request's later reconcile step replaces the conservative estimate
  // with real (here, much smaller) Anthropic usage almost immediately in
  // this fast in-memory simulation, which would close the very race
  // window under test before the assertion could observe it. This
  // isolates exactly the property FIX 1 guarantees — reservation, not
  // reconciliation — under two callers racing for the same budget.
  const admin = makeAdmin();
  const nearLimit = CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS - CHAT_SESSION_LIMITS.RESERVATION_TOKEN_ESTIMATE;
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: 1, cumulative_tokens: nearLimit,
    last_activity_at: Date.now(),
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
  });

  const reserveArgs = {
    p_session_id: SESSION_ID, p_user_id: USER_1,
    p_inactivity_timeout_seconds: Math.round(CHAT_SESSION_LIMITS.INACTIVITY_TIMEOUT_MS / 1000),
    p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES,
    p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
    p_estimated_tokens: CHAT_SESSION_LIMITS.RESERVATION_TOKEN_ESTIMATE,
  };

  const first = admin.reserveDirect(reserveArgs);
  const second = admin.reserveDirect(reserveArgs);

  assert.equal(first.ok, true, "the first racer, right at the boundary, is allowed");
  assert.equal(second.ok, false, "the second racer must be rejected using the FIRST racer's already-reserved estimate, not stale pre-race data");
  assert.equal(second.code, "SESSION_CLOSED");
  assert.equal(second.close_reason, "token_limit");

  const row = admin.sessions.get(SESSION_ID);
  assert.equal(row.status, "closed");
  assert.equal(row.close_reason, "token_limit");
  assert.equal(row.cumulative_tokens, CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS, "only the first racer's estimate was ever added — never both");
});

test("session closes once the 10-user-message boundary is reached (sequential)", async () => {
  const { handler, admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES - 1, cumulative_tokens: 0,
    last_activity_at: Date.now(),
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
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
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "SESSION_CLOSED");
  assert.equal(res.body.close_reason, "message_limit");
});

test("30-minute inactivity expiry closes the session and rejects the message", async () => {
  const { handler, admin } = makeHandler({ adminOptions: { now: 1_000_000_000 } });
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: true, credit_source: "included",
    user_message_count: 1, cumulative_tokens: 100,
    last_activity_at: 1_000_000_000,
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
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
    last_reservation_id: null, last_reservation_estimated_tokens: null, last_reservation_finalized: true,
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.close_reason, "first_call_refunded");

  const res2 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ session_id: OTHER_SESSION_ID }) }), res2);
  assert.equal(res2.statusCode, 200);
});

// --- FIX 2: reservation / reconciliation ---------------------------------

test("reservation succeeds, Anthropic succeeds, actual tokens reconcile exactly once", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { data: { content: [{ text: "ok" }], usage: { input_tokens: 40, output_tokens: 20 } } },
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);
  const row = admin.sessions.get(SESSION_ID);
  // Reserved with the conservative estimate, then reconciled DOWN to the
  // real 60 tokens (40+20) — never left at the inflated estimate.
  assert.equal(row.cumulative_tokens, 60);
  assert.equal(row.last_reservation_finalized, true);
  assert.equal(admin.calls.rpc.filter((c) => c.name === "reconcile_chat_message").length, 1);
});

test("duplicate reconciliation for the same reservation is idempotent — no double-counting", async () => {
  const { admin } = makeHandler();
  const sessionId = SESSION_ID;
  admin.sessions.set(sessionId, {
    id: sessionId, user_id: USER_1, status: "active", close_reason: null,
    credit_charged: false, credit_source: null, user_message_count: 1, cumulative_tokens: 3000,
    last_activity_at: Date.now(),
    last_reservation_id: "reservation-x", last_reservation_estimated_tokens: 3000, last_reservation_finalized: false,
  });

  const first = admin.reconcileDirect({
    p_session_id: sessionId, p_user_id: USER_1, p_reservation_id: "reservation-x",
    p_actual_tokens: 60, p_credit_charged: true, p_credit_source: "included",
    p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES, p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
  });
  assert.equal(first.ok, true);
  assert.equal(first.already_reconciled, false);
  assert.equal(admin.sessions.get(sessionId).cumulative_tokens, 60);

  // Retry with the same reservation id — must NOT reapply the delta.
  const second = admin.reconcileDirect({
    p_session_id: sessionId, p_user_id: USER_1, p_reservation_id: "reservation-x",
    p_actual_tokens: 60, p_credit_charged: true, p_credit_source: "included",
    p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES, p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
  });
  assert.equal(second.ok, true);
  assert.equal(second.already_reconciled, true);
  assert.equal(admin.sessions.get(sessionId).cumulative_tokens, 60, "a retried reconcile must not double-count tokens");
});

test("reconciliation temporary failure is detectable: durably logged to telemetry, response still delivered, session left null rather than fabricated", async () => {
  const upstreamFetch = makeFetch({ data: { content: [{ text: "réponse" }], usage: { input_tokens: 10, output_tokens: 10 } } });
  const admin2 = makeAdmin();
  const brokenAdmin = {
    ...admin2.client,
    async rpc(name, args) {
      if (name === "reconcile_chat_message") throw new Error("db timeout");
      return admin2.client.rpc(name, args);
    },
  };
  const handler = createChatHandler({ getAdminClient: () => brokenAdmin, fetchImpl: upstreamFetch.fetchImpl });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);

  assert.equal(res.statusCode, 200, "a delivered, paid-for reply must still reach the user");
  assert.equal(res.body.message.content, "réponse");
  assert.equal(res.body.session, null, "never fabricate session counters when reconciliation failed");

  const usageRows = admin2.calls.usage;
  const reconcileFailedRow = usageRows.find((r) => r.status === "reconcile_failed");
  assert.ok(reconcileFailedRow, "a reconcile failure must be durably logged, not just console.error'd");
  assert.equal(reconcileFailedRow.input_tokens, 10);
  assert.equal(reconcileFailedRow.output_tokens, 10);
  assert.equal(reconcileFailedRow.session_id, SESSION_ID);
});

// --- FIX 4: refund failure durability ------------------------------------

test("first-call Anthropic failure + successful refund: session closes with 'first_call_refunded', telemetry logs 'refunded'", async () => {
  const { handler, admin } = makeHandler({ fetchOptions: { throws: new Error("network down") } });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "FIRST_MESSAGE_FAILED");
  assert.equal(admin.sessions.get(SESSION_ID).status, "closed");
  assert.equal(admin.sessions.get(SESSION_ID).close_reason, "first_call_refunded");

  const refundCalls = admin.calls.rpc.filter((c) => c.name === "refund_ai_credit");
  assert.equal(refundCalls.length, 1);
  const usageRow = admin.calls.usage.find((r) => r.status === "refunded");
  assert.ok(usageRow, "a successful refund must still be logged to telemetry");
});

test("first-call Anthropic failure + refund failure: durable 'first_call_refund_failed' state, never pretends the refund succeeded", async () => {
  const adminHelper = makeAdmin();
  const brokenRefundAdmin = {
    ...adminHelper.client,
    async rpc(name, args) {
      if (name === "refund_ai_credit") return { data: { ok: false, code: "REFUND_ERROR" }, error: null };
      return adminHelper.client.rpc(name, args);
    },
  };
  const upstream = makeFetch({ throws: new Error("network down") });
  const handler = createChatHandler({ getAdminClient: () => brokenRefundAdmin, fetchImpl: upstream.fetchImpl });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);

  assert.equal(res.statusCode, 502);
  const row = adminHelper.sessions.get(SESSION_ID);
  assert.equal(row.status, "closed", "session must still be permanently closed even though the refund itself failed");
  assert.equal(row.close_reason, "first_call_refund_failed", "must NOT be reported as a successful refund");

  const usageRow = adminHelper.calls.usage.find((r) => r.status === "refund_failed");
  assert.ok(usageRow, "a failed refund must be durably logged to telemetry for admin/manual reconciliation");
});

test("a refund_failed session is permanently unusable, exactly like a refunded one — retry needs a new session id", async () => {
  const { admin } = makeHandler();
  admin.sessions.set(SESSION_ID, {
    id: SESSION_ID, user_id: USER_1, status: "closed", close_reason: "first_call_refund_failed",
    credit_charged: false, credit_source: null, user_message_count: 1, cumulative_tokens: 3000,
    last_activity_at: Date.now(),
    last_reservation_id: "reservation-x", last_reservation_estimated_tokens: 3000, last_reservation_finalized: false,
  });
  const handler = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: makeFetch().fetchImpl });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.close_reason, "first_call_refund_failed");

  const res2 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}`, body: baseBody({ session_id: OTHER_SESSION_ID }) }), res2);
  assert.equal(res2.statusCode, 200);
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
  const upstream2 = makeFetch();
  const handlerWithWorkingUpstream = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: upstream2.fetchImpl });
  const res = makeRes();
  await handlerWithWorkingUpstream(retryReq, res);
  assert.equal(res.statusCode, 200);
  const consumeForNewSession = admin.calls.rpc.filter((c) => c.name === "consume_ai_credit" && c.args.request_key === OTHER_SESSION_ID);
  assert.equal(consumeForNewSession.length, 1);
});

test("a LATER message failing after at least one success does NOT refund the original session credit, releases its reservation, and the session stays open for a retry", async () => {
  const { handler, admin } = makeHandler();
  const res1 = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res1);
  assert.equal(res1.statusCode, 200);
  const countAfterFirst = admin.sessions.get(SESSION_ID).user_message_count;

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
  // The failed attempt's reservation must be released, not left burning
  // a slot the user never got a reply for.
  assert.equal(admin.sessions.get(SESSION_ID).user_message_count, countAfterFirst);
  const releaseCalls = admin.calls.rpc.filter((c) => c.name === "release_chat_message_reservation");
  assert.equal(releaseCalls.length, 1);
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

// --- FIX 3: telemetry ------------------------------------------------

test("telemetry: a successful call logs model, tokens, first-message flag and credit source — never message content", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { data: { content: [{ text: "Oui, vous pouvez tailler maintenant." }], usage: { input_tokens: 77, output_tokens: 33, cache_creation_input_tokens: 5, cache_read_input_tokens: 2 } } },
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);

  const row = admin.calls.usage.find((r) => r.status === "succeeded");
  assert.ok(row);
  assert.equal(row.session_id, SESSION_ID);
  assert.equal(row.user_id, USER_1);
  assert.equal(row.model, "claude-sonnet-4-5");
  assert.equal(row.input_tokens, 77);
  assert.equal(row.output_tokens, 33);
  assert.equal(row.cache_creation_input_tokens, 5);
  assert.equal(row.cache_read_input_tokens, 2);
  assert.equal(row.is_first_message, true);
  assert.equal(row.credit_source, "included");
  assert.ok(row.reservation_id);

  const serialized = JSON.stringify(admin.calls.usage);
  assert.equal(serialized.includes("Oui, vous pouvez tailler maintenant"), false, "telemetry must never contain assistant response content");
  assert.equal(serialized.includes("Pourquoi mon hortensia jaunit"), false, "telemetry must never contain the user's message content");
});

test("telemetry: an upstream (later-message) failure is logged with status 'upstream_failed'", async () => {
  const { handler, admin } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());

  const failingUpstream = makeFetch({ status: 529, data: { error: { message: "overloaded" } } });
  const handlerFailing = createChatHandler({ getAdminClient: () => admin.client, fetchImpl: failingUpstream.fetchImpl });
  await handlerFailing(
    makeReq({ origin: `https://${HOST}`, body: baseBody({ messages: [{ role: "user", content: "encore" }] }) }),
    makeRes()
  );

  const row = admin.calls.usage.find((r) => r.status === "upstream_failed");
  assert.ok(row);
  assert.equal(row.is_first_message, false);
  assert.equal(row.upstream_status, 529);
});

test("telemetry: NO_CREDITS/FORBIDDEN/SESSION_CLOSED rejections that never reach Anthropic are not logged", async () => {
  const { handler, admin } = makeHandler({ adminOptions: { includedCredits: 0, purchasedCredits: 0 } });
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());
  assert.equal(admin.calls.usage.length, 0);
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
