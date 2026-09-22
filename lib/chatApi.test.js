// Tests lib/chatApi.js's pure client-side request logic via its
// injectable createChatClient({ getSupabase, isNative, webOrigin,
// fetchImpl, generateId }) factory — no DOM, no real Supabase client, no
// real network call. Matches the DI style used by lib/accountApi.js /
// lib/accountApi.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createChatClient } from "./chatApi.js";

const ACCESS_TOKEN = "test-access-token";
const SESSION_ID = "44444444-4444-4444-4444-444444444444";

function makeFakeSupabase({ session = { access_token: ACCESS_TOKEN } } = {}) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
    },
  };
}

function makeFakeFetch({ ok = true, status = 200, body = { session_id: SESSION_ID, message: { role: "assistant", content: "ok" }, session: null } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, async json() { return body; } };
  };
  return { fetchImpl, calls };
}

test("web (non-native): posts to the relative /api/chat path with session_id, messages and context", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const messages = [{ role: "user", content: "Bonjour" }];
  const context = { mode: "general" };
  const result = await sendMessage({ sessionId: SESSION_ID, messages, context });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/chat");
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.session_id, SESSION_ID);
  assert.deepEqual(sentBody.messages, messages);
  assert.deepEqual(sentBody.context, context);
});

test("native: posts to the absolute deployed origin, never a relative path", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => true,
    webOrigin: () => "https://almeo.app",
    fetchImpl,
  });

  await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.equal(calls[0].url, "https://almeo.app/api/chat");
});

test("native with no configured web origin: fails loudly (generic error), never guesses a URL", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => true,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(result, { ok: false, errorCode: "generic" });
  assert.equal(calls.length, 0);
});

test("sends the current access token as a Bearer header, and never a userId anywhere in the request", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  const serialized = JSON.stringify(calls[0].init);
  assert.equal(serialized.toLowerCase().includes("userid"), false);
});

test("no Supabase client configured: fails without attempting a fetch", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => null,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(result, { ok: false, errorCode: "generic" });
  assert.equal(calls.length, 0);
});

test("no active session: fails with session_expired, never attempts a fetch", async () => {
  const supabase = makeFakeSupabase({ session: null });
  const { fetchImpl, calls } = makeFakeFetch();
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(result, { ok: false, errorCode: "session_expired" });
  assert.equal(calls.length, 0);
});

test("network failure surfaces as errorCode 'network'", async () => {
  const supabase = makeFakeSupabase();
  const fetchImpl = async () => { throw new Error("offline"); };
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(result, { ok: false, errorCode: "network" });
});

test("server error responses surface the server's machine-readable code (e.g. NO_CREDITS), not a generic string", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl } = makeFakeFetch({
    ok: false,
    status: 402,
    body: { error: "NO_CREDITS", code: "NO_CREDITS", included_credits: 0, purchased_credits: 0 },
  });
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "NO_CREDITS");
  assert.equal(result.status, 402);
});

test("server error response with no machine-readable code falls back to 'generic'", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl } = makeFakeFetch({ ok: false, status: 500, body: { error: "boom" } });
  const { sendMessage } = createChatClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await sendMessage({ sessionId: SESSION_ID, messages: [{ role: "user", content: "hi" }] });
  assert.equal(result.errorCode, "generic");
});

test("createSessionId(): returns a fresh id from the injected generator each call", () => {
  let counter = 0;
  const { createSessionId } = createChatClient({ generateId: () => `id-${++counter}` });
  assert.equal(createSessionId(), "id-1");
  assert.equal(createSessionId(), "id-2");
});

test("createSessionId(): throws rather than silently returning an unusable falsy id", () => {
  const { createSessionId } = createChatClient({ generateId: () => null });
  assert.throws(() => createSessionId());
});
