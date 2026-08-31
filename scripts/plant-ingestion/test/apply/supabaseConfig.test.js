import { test } from "node:test";
import assert from "node:assert/strict";

import { getSupabaseConfig } from "../../src/apply/supabaseConfig.js";

test("reports hasUrl/hasServiceRoleKey false and null values when the env vars are absent", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const config = getSupabaseConfig();
    assert.equal(config.hasUrl, false);
    assert.equal(config.hasServiceRoleKey, false);
    assert.equal(config.url, null);
    assert.equal(config.serviceRoleKey, null);
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
    if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("reads real values from process.env when present, exposing both the raw value and a boolean flag", () => {
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

test("the returned object never carries any key beyond the four documented fields", () => {
  const config = getSupabaseConfig();
  assert.deepEqual(Object.keys(config).sort(), ["hasServiceRoleKey", "hasUrl", "serviceRoleKey", "url"]);
});
