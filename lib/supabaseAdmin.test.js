import { test } from "node:test";
import assert from "node:assert/strict";

import { createSupabaseAdminClient, getSupabaseAdminConfig } from "./supabaseAdmin.js";

test("createSupabaseAdminClient: throws when url is missing", () => {
  assert.throws(() => createSupabaseAdminClient({ url: null, serviceRoleKey: "key" }));
});

test("createSupabaseAdminClient: throws when serviceRoleKey is missing", () => {
  assert.throws(() => createSupabaseAdminClient({ url: "https://example.supabase.co", serviceRoleKey: null }));
});

test("createSupabaseAdminClient: succeeds with both values present", () => {
  const client = createSupabaseAdminClient({ url: "https://example.supabase.co", serviceRoleKey: "fake-service-role-key" });
  assert.ok(client);
  assert.equal(typeof client.auth.admin.deleteUser, "function");
});

test("getSupabaseAdminConfig: reports hasUrl/hasServiceRoleKey booleans without ever throwing", () => {
  const config = getSupabaseAdminConfig();
  assert.equal(typeof config.hasUrl, "boolean");
  assert.equal(typeof config.hasServiceRoleKey, "boolean");
  // Never returns an empty-string secret as "present" — only a real value
  // or null.
  if (!config.hasServiceRoleKey) assert.equal(config.serviceRoleKey, null);
  if (!config.hasUrl) assert.equal(config.url, null);
});
