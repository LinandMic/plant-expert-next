import { test } from "node:test";
import assert from "node:assert/strict";

import { config as proxyConfig, createProxyHandler } from "../pages/api/proxy.js";
import { ANTHROPIC_ANALYSIS_TIMEOUT_MS, ANTHROPIC_REQUEST_TIMEOUT_MS } from "../lib/anthropicRequestConfig.js";

const HOST = "plant-expert-next-rxq9.vercel.app";
const VALID_BODY = {
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

// `authorization: null` (never `undefined`) is how a caller asks for "no
// token" below — a destructured default parameter substitutes its default
// whenever the passed value is `undefined`, so `{ authorization: undefined }`
// would silently keep the default "Bearer test-token" instead of omitting
// it. (Confirmed against pages/api/proxy.js directly: it correctly 401s on
// a genuinely absent header — this was purely a test-helper footgun, not a
// handler bug; the two call sites below were passing `undefined` and
// therefore never actually testing what they claimed to.)
function makeReq({
  method = "POST",
  origin,
  referer,
  body = VALID_BODY,
  authorization = "Bearer test-token",
} = {}) {
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
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function makeAdmin({
  user = { id: "user-1" },
  authError = null,
  consumeData = {
    ok: true,
    credit_source: "included",
    included_credits: 4,
    purchased_credits: 0,
  },
  consumeError = null,
  refundData = { ok: true, credit_source: "included" },
  refundError = null,
  usageError = null,
} = {}) {
  const calls = {
    auth: [],
    rpc: [],
    usage: [],
  };

  const client = {
    auth: {
      async getUser(token) {
        calls.auth.push(token);
        return {
          data: { user: authError ? null : user },
          error: authError,
        };
      },
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "consume_ai_credit") {
        return { data: consumeData, error: consumeError };
      }
      if (name === "refund_ai_credit") {
        return { data: refundData, error: refundError };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, "ai_analysis_usage");
      return {
        async insert(row) {
          calls.usage.push(row);
          return { data: null, error: usageError };
        },
      };
    },
  };

  return { client, calls };
}

function makeAbortError() {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

// A fetchImpl whose timing is fully controlled by the test, not by a
// pre-made thrown error -- used to drive the real createAnthropicTimeout
// signal (via node:test's mock timers) through both "aborts before
// headers arrive" and "headers arrive, then the body stalls and aborts
// mid-read", exactly as a real stuck Anthropic connection or a stalled
// response stream would behave. Mirrors genuine Fetch API/undici
// behavior: once `signal` aborts, both a still-pending fetch call and an
// independently-started response.json() reject with the same AbortError.
function makeControllableFetch({ status = 200, data = {} } = {}) {
  let signal = null;
  let resolveHeaders, rejectHeaders;
  const headersGate = new Promise((resolve, reject) => {
    resolveHeaders = resolve;
    rejectHeaders = reject;
  });
  let resolveBody;
  const bodyGate = new Promise((resolve) => {
    resolveBody = resolve;
  });
  // Resolves the instant fetchImpl actually starts running -- i.e. once
  // createAnthropicTimeout() has already registered its (mocked) real
  // timer in the handler. Awaiting this before advancing the mock clock
  // removes any race against however many unrelated awaits (auth,
  // credit consumption, ...) the handler performs before reaching the
  // fetch call.
  let resolveCalled;
  const calledGate = new Promise((resolve) => {
    resolveCalled = resolve;
  });

  const fetchImpl = async (_url, options) => {
    signal = options.signal;
    signal.addEventListener("abort", () => rejectHeaders(makeAbortError()), { once: true });
    resolveCalled();
    await headersGate;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () =>
        new Promise((resolve, reject) => {
          if (signal.aborted) return reject(makeAbortError());
          signal.addEventListener("abort", () => reject(makeAbortError()), { once: true });
          bodyGate.then(resolve);
        }),
    };
  };

  return {
    fetchImpl,
    whenCalled: () => calledGate,
    letHeadersArrive: () => resolveHeaders(),
    letBodyArrive: () => resolveBody(data),
    getSignal: () => signal,
  };
}

function makeFetch({
  status = 200,
  data = {
    content: [{ type: "text", text: "{\"ok\":true}" }],
    usage: { input_tokens: 120, output_tokens: 45 },
  },
  throws = null,
} = {}) {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    if (throws) throw throws;
    return {
      status,
      ok: status >= 200 && status < 300,
      async json() {
        return data;
      },
    };
  };
  return { fetchImpl, calls };
}

function makeHandler({ adminOptions, fetchOptions } = {}) {
  const admin = makeAdmin(adminOptions);
  const upstream = makeFetch(fetchOptions);
  const handler = createProxyHandler({
    getAdminClient: () => admin.client,
    fetchImpl: upstream.fetchImpl,
    makeRequestId: () => "request-1",
  });
  return { handler, admin, upstream };
}

test("authenticated same-origin request consumes one credit and reaches Anthropic", async () => {
  const { handler, admin, upstream } = makeHandler();
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(upstream.calls.length, 1);
  assert.deepEqual(admin.calls.auth, ["test-token"]);
  assert.equal(admin.calls.rpc.length, 1);
  assert.equal(admin.calls.rpc[0].name, "consume_ai_credit");
  assert.deepEqual(admin.calls.rpc[0].args, {
    target_user_id: "user-1",
    request_key: "request-1",
  });
  assert.equal(admin.calls.usage.length, 1);
  assert.equal(admin.calls.usage[0].status, "succeeded");
  assert.equal(admin.calls.usage[0].input_tokens, 120);
  assert.equal(admin.calls.usage[0].output_tokens, 45);
  assert.equal(res.body.content[0].text, "{\"ok\":true}");
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("allowed native origin gets scoped CORS including Authorization", async () => {
  const { handler, upstream } = makeHandler();
  const req = makeReq({ origin: "capacitor://localhost" });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(upstream.calls.length, 1);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
  assert.equal(res.headers["Vary"], "Origin");
});

test("OPTIONS for native origin permits only POST and required headers", async () => {
  const { handler } = makeHandler();
  const req = makeReq({ method: "OPTIONS", origin: "https://localhost", authorization: null });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://localhost");
  assert.equal(res.headers["Access-Control-Allow-Methods"], "POST");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type, Authorization");
  assert.equal(res.headers["Allow"], "POST, OPTIONS");
});

test("unknown external origin is rejected before auth, credits, or Anthropic", async () => {
  const { handler, admin, upstream } = makeHandler();
  const req = makeReq({ origin: "https://evil.example.com" });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
  assert.equal(admin.calls.auth.length, 0);
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(upstream.calls.length, 0);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("missing bearer token is rejected before any paid call", async () => {
  const { handler, admin, upstream } = makeHandler();
  const req = makeReq({
    origin: `https://${HOST}`,
    authorization: null,
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "AUTH_REQUIRED");
  assert.equal(admin.calls.auth.length, 0);
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("invalid session is rejected before credit consumption", async () => {
  const { handler, admin, upstream } = makeHandler({
    adminOptions: { authError: new Error("invalid token") },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "AUTH_REQUIRED");
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(upstream.calls.length, 0);
});

test("NO_CREDITS returns 402 and Anthropic is never called", async () => {
  const { handler, admin, upstream } = makeHandler({
    adminOptions: {
      consumeData: {
        ok: false,
        code: "NO_CREDITS",
        included_credits: 0,
        purchased_credits: 0,
      },
    },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "NO_CREDITS");
  assert.equal(admin.calls.rpc.length, 1);
  assert.equal(admin.calls.rpc[0].name, "consume_ai_credit");
  assert.equal(upstream.calls.length, 0);
  assert.equal(admin.calls.usage.length, 0);
});

test("Anthropic network failure refunds the consumed credit and records it", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { throws: new Error("network down") },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.rpc.length, 2);
  assert.equal(admin.calls.rpc[0].name, "consume_ai_credit");
  assert.equal(admin.calls.rpc[1].name, "refund_ai_credit");
  assert.deepEqual(admin.calls.rpc[1].args, {
    target_user_id: "user-1",
    request_key: "request-1",
  });
  assert.equal(admin.calls.usage.length, 1);
  assert.equal(admin.calls.usage[0].status, "refunded");
});

test("Anthropic request timeout (AbortError) is refunded exactly like any other network failure, but logged distinctly", async () => {
  const abortError = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const { handler, admin } = makeHandler({
    fetchOptions: { throws: abortError },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await handler(req, res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.rpc.length, 2);
  assert.equal(admin.calls.rpc[1].name, "refund_ai_credit");
  assert.equal(admin.calls.usage.length, 1);
  assert.equal(admin.calls.usage[0].status, "refunded", "same refund behavior as any other upstream failure");
  assert.ok(
    logged.some((line) => line.includes("timed out")),
    "a timeout must be logged distinctly from a generic 'Anthropic proxy error'"
  );
});

test("the 100s analysis timeout, fired for real via a mocked clock, aborts before headers arrive -- and the 25s chat timeout does not apply", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const admin = makeAdmin();
  const upstream = makeControllableFetch();
  const handler = createProxyHandler({
    getAdminClient: () => admin.client,
    fetchImpl: upstream.fetchImpl,
    makeRequestId: () => "request-1",
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  const handlerPromise = handler(req, res);
  // Wait until fetchImpl is actually invoked -- i.e. until
  // createAnthropicTimeout() has already registered its (mocked) real
  // timer -- before advancing the clock, so this never races against
  // however many unrelated awaits (auth, credit consumption, ...) the
  // handler performs first. Headers are then never let through: the
  // real 100s analysis timer (mocked) is what must abort the still-pending
  // fetch call.
  await upstream.whenCalled();
  // Image analysis routinely takes longer than the 25s chat budget: the
  // proxy must still be waiting at that point.
  t.mock.timers.tick(ANTHROPIC_REQUEST_TIMEOUT_MS);
  assert.equal(upstream.getSignal().aborted, false, "the 25s chat timeout must not abort an image analysis");
  t.mock.timers.tick(ANTHROPIC_ANALYSIS_TIMEOUT_MS - ANTHROPIC_REQUEST_TIMEOUT_MS - 1);
  assert.equal(upstream.getSignal().aborted, false, "must not fire a moment early");
  t.mock.timers.tick(1);
  try {
    await handlerPromise;
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.rpc.length, 2);
  assert.equal(admin.calls.rpc[1].name, "refund_ai_credit");
  assert.equal(admin.calls.usage.length, 1, "exactly one usage record -- no double refund");
  assert.equal(admin.calls.usage[0].status, "refunded");
  assert.ok(logged.some((line) => line.includes("timed out")));
});

test("headers are received, then the response body stalls and times out mid-read -- refunded exactly once, logged distinctly from a parse error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const admin = makeAdmin();
  const upstream = makeControllableFetch();
  const handler = createProxyHandler({
    getAdminClient: () => admin.client,
    fetchImpl: upstream.fetchImpl,
    makeRequestId: () => "request-1",
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  const handlerPromise = handler(req, res);
  await upstream.whenCalled();
  upstream.letHeadersArrive();
  // Let the microtask queue drain so response.json() is actually called
  // and registers its own abort listener before the timer fires.
  await Promise.resolve();
  await Promise.resolve();
  // The body never arrives -- the same 100s analysis timer must abort the
  // stalled read, not just the initial connection.
  t.mock.timers.tick(ANTHROPIC_ANALYSIS_TIMEOUT_MS);
  try {
    await handlerPromise;
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.rpc.length, 2);
  assert.equal(admin.calls.rpc[1].name, "refund_ai_credit");
  assert.equal(admin.calls.usage.length, 1, "exactly one usage record -- no double refund between the two catch blocks");
  assert.equal(admin.calls.usage[0].status, "refunded");
  assert.ok(
    logged.some((line) => line.includes("timed out while reading the response body")),
    "must be distinguishable from both a generic parse error and a pre-headers timeout"
  );
});

test("maxDuration leaves at least 10s for the refund path after the analysis timeout fires", () => {
  assert.equal(ANTHROPIC_ANALYSIS_TIMEOUT_MS, 100000);
  assert.equal(proxyConfig.maxDuration, 120);
  assert.ok(
    proxyConfig.maxDuration * 1000 - ANTHROPIC_ANALYSIS_TIMEOUT_MS >= 10000,
    "if Vercel terminates the function before the timeout fires, the consumed credit is never refunded"
  );
  // Hobby + Fluid compute ceiling.
  assert.ok(proxyConfig.maxDuration <= 300);
  assert.deepEqual(proxyConfig.api, { bodyParser: { sizeLimit: "2mb" } }, "bodyParser config is unchanged");
});

test("a normal response clears the real timer -- it never fires even long after the response has completed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const admin = makeAdmin();
  const upstream = makeControllableFetch({
    data: { content: [{ type: "text", text: "{\"ok\":true}" }], usage: { input_tokens: 10, output_tokens: 5 } },
  });
  const handler = createProxyHandler({
    getAdminClient: () => admin.client,
    fetchImpl: upstream.fetchImpl,
    makeRequestId: () => "request-1",
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  const handlerPromise = handler(req, res);
  await upstream.whenCalled();
  upstream.letHeadersArrive();
  await Promise.resolve();
  upstream.letBodyArrive();
  await handlerPromise;

  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.rpc.length, 1, "no refund on a normal success");

  const signal = upstream.getSignal();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(ANTHROPIC_ANALYSIS_TIMEOUT_MS * 10);
  assert.equal(signal.aborted, false, "clear() must have cancelled the real timer -- it must never fire this late");
});

test("Anthropic non-2xx response is refunded", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: {
      status: 529,
      data: { error: { message: "overloaded" } },
    },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 529);
  assert.equal(admin.calls.rpc.length, 2);
  assert.equal(admin.calls.rpc[1].name, "refund_ai_credit");
  assert.equal(admin.calls.usage[0].status, "refunded");
  assert.equal(admin.calls.usage[0].upstream_status, 529);
});

test("refund failure is visible in metering without hiding the upstream error", async () => {
  const { handler, admin } = makeHandler({
    adminOptions: { refundError: new Error("refund failed") },
    fetchOptions: { throws: new Error("network down") },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.usage.length, 1);
  assert.equal(admin.calls.usage[0].status, "refund_failed");
});

// --- claude-sonnet-5-5 migration -------------------------------------------

test("upstream body: claude-sonnet-5-5, no assistant prefill, thinking between_tools, effort high", async () => {
  const { handler, upstream } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}` }), makeRes());
  const sentBody = JSON.parse(upstream.calls[0][1].body);
  assert.equal(sentBody.model, "claude-sonnet-5-5");
  assert.equal(sentBody.messages[sentBody.messages.length - 1].role, "user", "the last message must be the user's, never an assistant prefill");
  assert.equal(sentBody.messages.some((m) => m.role === "assistant"), false);
  assert.deepEqual(sentBody.thinking, { type: "between_tools" });
  assert.deepEqual(sentBody.output_config, { effort: "high" });
});

test("a model sent by the client is ignored: the server always uses ANTHROPIC_MODEL", async () => {
  const { handler, upstream } = makeHandler();
  await handler(makeReq({ origin: `https://${HOST}`, body: { ...VALID_BODY, model: "claude-opus-5-5" } }), makeRes());
  assert.equal(JSON.parse(upstream.calls[0][1].body).model, "claude-sonnet-5-5");
});

test("the answer is read from the text block even after a thinking block, and is never prefixed with '{'", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { data: { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"ok\":true}" }], usage: { input_tokens: 10, output_tokens: 5 } } },
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 200);
  const text = res.body.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  assert.equal(text, "{\"ok\":true}");
  assert.equal(admin.calls.usage[0].status, "succeeded");
});

test("stop_reason refusal (no text block) keeps the current behavior: 502 + refund", async () => {
  const { handler, admin } = makeHandler({
    fetchOptions: { data: { stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
  });
  const res = makeRes();
  await handler(makeReq({ origin: `https://${HOST}` }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(admin.calls.rpc.filter((c) => c.name === "refund_ai_credit").length, 1);
  assert.equal(admin.calls.usage[0].status, "refunded");
});
