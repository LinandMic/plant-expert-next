import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPlan } from "../../src/apply/applyPlan.js";
import { verifyPlan } from "../../src/apply/verifyPlan.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildMiniPlan } from "./fixtures.js";

test("passes with every check green right after a real apply of the same plan", async () => {
  const { client } = createFakeSupabaseClient();
  const plan = buildMiniPlan();
  await applyPlan({ client, plan, dryRun: false });

  const result = await verifyPlan({ client, plan });
  assert.equal(result.ok, true);
  assert.equal(result.summary.failed, 0);
  assert.ok(result.summary.total > 0);
  assert.equal(result.summary.passed, result.summary.total);
});

test("fails when the plan was never applied (nothing exists in the DB)", async () => {
  const { client } = createFakeSupabaseClient();
  const result = await verifyPlan({ client, plan: buildMiniPlan() });
  assert.equal(result.ok, false);
  assert.ok(result.summary.failed > 0);
  assert.ok(result.checks.some((c) => !c.ok && c.message.includes("plant_taxa")));
});

test("detects a duplicate row (two catalog rows sharing the plan's slug)", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const plan = buildMiniPlan();
  await applyPlan({ client, plan, dryRun: false });
  // Corrupt the fake DB: insert a second row with the same slug (would
  // never happen with the real unique constraint, but verifyPlan must
  // still catch it defensively).
  tables.plant_catalog.push({ ...tables.plant_catalog[0], id: "duplicate-id" });

  const result = await verifyPlan({ client, plan });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.ok && c.message.includes("expected exactly 1 row for slug")));
});

test("detects an FK coherence failure (catalog entry linked to the wrong taxon)", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const plan = buildMiniPlan();
  await applyPlan({ client, plan, dryRun: false });
  tables.plant_catalog[0].taxon_id = "some-other-taxon-id";

  const result = await verifyPlan({ client, plan });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => !c.ok && c.message.includes("wrong taxon")));
});

test("rejects a guard-invalid plan before running any check", async () => {
  const { client } = createFakeSupabaseClient();
  const plan = { ...buildMiniPlan(), approval_required: false };
  const result = await verifyPlan({ client, plan });
  assert.equal(result.ok, false);
  assert.equal(result.summary, null);
});
