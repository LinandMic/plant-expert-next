// Tests lib/accountApi.js's pure client-side request logic via its
// injectable createAccountDeleteClient({ getSupabase, isNative, webOrigin,
// fetchImpl }) factory — no DOM, no real Supabase client, no real network
// call. Matches the DI style used by pages/api/account/delete.js's own
// createAccountDeleteHandler, tested in lib/accountDeleteHandler.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAccountDeleteClient } from "./accountApi.js";

const ACCESS_TOKEN = "test-access-token";

function makeFakeSupabase({ session = { access_token: ACCESS_TOKEN }, getSessionError = null } = {}) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: getSessionError }),
    },
  };
}

function makeFakeFetch({ ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status };
  };
  return { fetchImpl, calls };
}

test("web (non-native): posts to the relative /api/account/delete path", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/account/delete");
  assert.equal(calls[0].init.method, "POST");
});

test("native: posts to the absolute deployed origin, never a relative path", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => true,
    webOrigin: () => "https://almeo.app",
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, "https://almeo.app/api/account/delete");
});

test("native with no configured web origin: fails loudly (generic error), never guesses a URL", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => true,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: false, errorCode: "generic" });
  assert.equal(calls.length, 0);
});

test("sends the current access token as a Bearer header, and never a userId anywhere in the request", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  await deleteAccount();
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  const serialized = JSON.stringify(calls[0].init);
  assert.equal(serialized.includes("userId"), false);
});

test("no Supabase client configured: fails without attempting a fetch", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => null,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: false, errorCode: "generic" });
  assert.equal(calls.length, 0);
});

test("no active session: fails with session_expired, never attempts a fetch", async () => {
  const supabase = makeFakeSupabase({ session: null });
  const { fetchImpl, calls } = makeFakeFetch();
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: false, errorCode: "session_expired" });
  assert.equal(calls.length, 0);
});

test("network failure surfaces as errorCode 'network'", async () => {
  const supabase = makeFakeSupabase();
  const fetchImpl = async () => {
    throw new Error("offline");
  };
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: false, errorCode: "network" });
});

test("non-ok server response surfaces as errorCode 'generic', response body never inspected for identity", async () => {
  const supabase = makeFakeSupabase();
  const { fetchImpl } = makeFakeFetch({ ok: false, status: 500 });
  const { deleteAccount } = createAccountDeleteClient({
    getSupabase: () => supabase,
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await deleteAccount();
  assert.deepEqual(result, { ok: false, errorCode: "generic" });
});
