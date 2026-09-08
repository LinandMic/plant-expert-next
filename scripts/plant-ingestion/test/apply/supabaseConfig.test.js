import { test } from "node:test";
import assert from "node:assert/strict";

import { getSupabaseConfig, resolveSupabaseConfig } from "../../src/apply/supabaseConfig.js";

// resolveSupabaseConfig is fully hermetic: env and fileValues are both
// plain objects passed in explicitly, never the real process.env or the
// real local .env.ingestion file — so these tests behave identically
// whether or not a real .env.ingestion happens to exist on the machine
// running them (previously, getSupabaseConfig()-based tests that deleted
// process.env.SUPABASE_* still silently fell back to a real local
// .env.ingestion's real values on any machine where one exists, e.g. the
// Mac used for real Layer C runs). No real secret values appear below.

test("1: env absent + fileValues={} -> hasUrl=false, hasServiceRoleKey=false, both raw values null", () => {
  const config = resolveSupabaseConfig({ env: {}, fileValues: {} });
  assert.equal(config.hasUrl, false);
  assert.equal(config.hasServiceRoleKey, false);
  assert.equal(config.url, null);
  assert.equal(config.serviceRoleKey, null);
});

test("2: env present -> env wins, even with no fileValues fallback available", () => {
  const config = resolveSupabaseConfig({
    env: { SUPABASE_URL: "https://env-example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "env-fake-key" },
    fileValues: {},
  });
  assert.equal(config.hasUrl, true);
  assert.equal(config.hasServiceRoleKey, true);
  assert.equal(config.url, "https://env-example.supabase.co");
  assert.equal(config.serviceRoleKey, "env-fake-key");
});

test("3: env absent + fileValues present -> the file fallback is used", () => {
  const config = resolveSupabaseConfig({
    env: {},
    fileValues: { SUPABASE_URL: "https://file-example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "file-fake-key" },
  });
  assert.equal(config.hasUrl, true);
  assert.equal(config.hasServiceRoleKey, true);
  assert.equal(config.url, "https://file-example.supabase.co");
  assert.equal(config.serviceRoleKey, "file-fake-key");
});

test("4: env present + fileValues different -> env stays authoritative, file value never leaks through", () => {
  const config = resolveSupabaseConfig({
    env: { SUPABASE_URL: "https://env-example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "env-fake-key" },
    fileValues: { SUPABASE_URL: "https://file-example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "file-fake-key" },
  });
  assert.equal(config.url, "https://env-example.supabase.co");
  assert.equal(config.serviceRoleKey, "env-fake-key");
});

test("5: the returned object never carries any key beyond the four documented fields", () => {
  const config = resolveSupabaseConfig({ env: {}, fileValues: {} });
  assert.deepEqual(Object.keys(config).sort(), ["hasServiceRoleKey", "hasUrl", "serviceRoleKey", "url"]);
});

// getSupabaseConfig() itself is the thin, non-hermetic production wrapper
// around resolveSupabaseConfig — it necessarily touches the real
// process.env and the real local .env.ingestion fallback (spec: reads from
// the process environment first, falls back to the optional local env
// file). It is deliberately NOT exercised with process.env deletion here
// (that depends on whatever real .env.ingestion happens to exist on the
// machine running the suite) — only its env-wins-when-present path, and
// its returned shape, both of which hold regardless of any local file.
test("getSupabaseConfig: when real env vars are set, they are reflected verbatim (env still wins over any local file)", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    const config = getSupabaseConfig();
    assert.equal(config.hasUrl, true);
    assert.equal(config.hasServiceRoleKey, true);
    assert.equal(config.url, "https://example.supabase.co");
    assert.equal(config.serviceRoleKey, "test-service-role-key");
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("getSupabaseConfig: the returned object never carries any key beyond the four documented fields", () => {
  const config = getSupabaseConfig();
  assert.deepEqual(Object.keys(config).sort(), ["hasServiceRoleKey", "hasUrl", "serviceRoleKey", "url"]);
});
