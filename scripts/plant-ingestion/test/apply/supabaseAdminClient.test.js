import { test } from "node:test";
import assert from "node:assert/strict";

import { createSupabaseAdminClient } from "../../src/apply/supabaseAdminClient.js";

test("throws when url is missing", () => {
  assert.throws(() => createSupabaseAdminClient({ url: null, serviceRoleKey: "test-key" }), /url and serviceRoleKey are both required/);
});

test("throws when serviceRoleKey is missing", () => {
  assert.throws(() => createSupabaseAdminClient({ url: "https://example.supabase.co", serviceRoleKey: null }), /url and serviceRoleKey are both required/);
});

test("throws when both are missing", () => {
  assert.throws(() => createSupabaseAdminClient({}), /url and serviceRoleKey are both required/);
});

test("builds a real Supabase client (with a .from() query builder) when both values are present", () => {
  const client = createSupabaseAdminClient({ url: "https://example.supabase.co", serviceRoleKey: "test-service-role-key" });
  assert.equal(typeof client.from, "function");
});
