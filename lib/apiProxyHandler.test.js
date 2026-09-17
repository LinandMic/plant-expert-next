// Tests pages/api/proxy.js's handler directly, with a minimal hand-rolled
// req/res (no test dependency added) and a stubbed global fetch so no real
// network call reaches Anthropic.
//
// Deliberately NOT colocated under pages/api/ as pages/api/proxy.test.js:
// Next.js's pages router treats every file under pages/ as a route by file
// path, with no built-in exclusion for *.test.js, so a test file there was
// picked up as a real (broken) route — `/api/proxy.test` — in `next build`'s
// route table. lib/ is outside the pages/ routing tree, which is also why
// every other test in this project already lives here.
import { test } from "node:test";
import assert from "node:assert/strict";

import handler from "../pages/api/proxy.js";

// The deployed host this route runs behind in production (matches the
// NEXT_PUBLIC_WEB_ORIGIN configured for the native build) — only used here
// as the request's own Host header, so "same-origin" has something real to
// compare against.
const HOST = "plant-expert-next-rxq9.vercel.app";

function makeReq({ method = "POST", origin, referer, body } = {}) {
  const headers = { host: HOST };
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;
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

const VALID_BODY = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };

function stubUpstreamSuccess() {
  const prevFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { status: 200, json: async () => ({ content: [{ text: "ok" }] }) };
  };
  return {
    callCount: () => calls,
    restore: () => {
      globalThis.fetch = prevFetch;
    },
  };
}

test("normal same-origin web request is accepted, no CORS headers added", async () => {
  const upstream = stubUpstreamSuccess();
  try {
    const req = makeReq({ origin: `https://${HOST}`, body: VALID_BODY });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(upstream.callCount(), 1);
    assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  } finally {
    upstream.restore();
  }
});

test("allowed Capacitor iOS origin (capacitor://localhost) is accepted with exact-origin CORS headers", async () => {
  const upstream = stubUpstreamSuccess();
  try {
    const req = makeReq({ origin: "capacitor://localhost", body: VALID_BODY });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(upstream.callCount(), 1);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
    assert.equal(res.headers["Vary"], "Origin");
  } finally {
    upstream.restore();
  }
});

test("allowed Capacitor Android origin (https://localhost) is accepted with exact-origin CORS headers", async () => {
  const upstream = stubUpstreamSuccess();
  try {
    const req = makeReq({ origin: "https://localhost", body: VALID_BODY });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(upstream.callCount(), 1);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://localhost");
    assert.equal(res.headers["Vary"], "Origin");
  } finally {
    upstream.restore();
  }
});

test("unknown external origin is rejected, never gets Access-Control-Allow-Origin: *", async () => {
  const upstream = stubUpstreamSuccess();
  try {
    const req = makeReq({ origin: "https://evil.example.com", body: VALID_BODY });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Forbidden" });
    assert.equal(upstream.callCount(), 0);
    assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  } finally {
    upstream.restore();
  }
});

test("OPTIONS preflight for an allowed native origin succeeds with scoped CORS headers", async () => {
  const req = makeReq({ method: "OPTIONS", origin: "capacitor://localhost" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
  assert.equal(res.headers["Vary"], "Origin");
  // Scoped to exactly what the client sends — no wildcard, no extra verbs/headers.
  assert.equal(res.headers["Access-Control-Allow-Methods"], "POST");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type");
  assert.equal(res.headers["Allow"], "POST, OPTIONS");
});

test("OPTIONS preflight from an unknown origin never gains CORS access", async () => {
  const req = makeReq({ method: "OPTIONS", origin: "https://evil.example.com" });
  const res = makeRes();
  await handler(req, res);
  // Preflight itself doesn't leak whether a route exists (status stays 204,
  // matching the pre-existing behavior for any OPTIONS request), but the
  // browser never proceeds without Access-Control-Allow-Origin, which must
  // be entirely absent here.
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(res.headers["Access-Control-Allow-Methods"], undefined);
  assert.equal(res.headers["Access-Control-Allow-Headers"], undefined);
});
