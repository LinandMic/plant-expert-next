import { test } from "node:test";
import assert from "node:assert/strict";

import { createProxyHandler } from "../pages/api/proxy.js";

const HOST = "plant-expert-next-rxq9.vercel.app";
const VALID_BODY = {
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

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
  if (authorization !== undefined) headers.authorization = authorization;
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

function makeFetch({
  status = 200,
  data = {
    content: [{ text: "\"ok\":true}" }],
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
  const req = makeReq({ method: "OPTIONS", origin: "https://localhost", authorization: undefined });
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
    authorization: undefined,
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
