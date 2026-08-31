import { test } from "node:test";
import assert from "node:assert/strict";

import { guardPlan } from "../../src/apply/planGuard.js";
import { buildMiniPlan, buildTaxonName, buildCatalogEntry, buildSourceRecord, buildProviderObservation, buildSelection } from "./fixtures.js";

test("a valid plan passes guardPlan with zero errors", () => {
  assert.deepEqual(guardPlan(buildMiniPlan()), []);
});

test("a non-object plan is rejected", () => {
  assert.deepEqual(guardPlan(null), ["plan must be a JSON object"]);
});

test("mode must be transaction_plan", () => {
  const plan = { ...buildMiniPlan(), mode: "dry_run" };
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("plan.mode")));
});

test("approval_required must be true", () => {
  const plan = { ...buildMiniPlan(), approval_required: false };
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("approval_required")));
});

test("a missing required array is rejected", () => {
  const plan = { ...buildMiniPlan() };
  delete plan.trait_selections;
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("plan.trait_selections must be an array")));
});

test("a taxon_names entry with a dangling taxon_ref is rejected", () => {
  const plan = buildMiniPlan({ taxon_names: [buildTaxonName({ taxon_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("unknown taxon_ref")));
});

test("a catalog_entries entry with a dangling parent_catalog_ref is rejected", () => {
  const plan = buildMiniPlan({ catalog_entries: [buildCatalogEntry({ parent_catalog_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("unknown parent_catalog_ref")));
});

test("a source_records entry with a dangling catalog_ref is rejected", () => {
  const plan = buildMiniPlan({ source_records: [buildSourceRecord({ catalog_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("unknown catalog_ref")));
});

test("a non-editorial trait_observations entry with a dangling source_record_ref is rejected", () => {
  const plan = buildMiniPlan({ trait_observations: [buildProviderObservation({ source_record_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("unknown source_record_ref")));
});

test("a trait_selections entry with a dangling selected_observation_ref is rejected", () => {
  const plan = buildMiniPlan({ trait_selections: [buildSelection({ selected_observation_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("unknown selected_observation_ref")));
});

test("a trait_selections entry with a dangling catalog_ref is rejected", () => {
  const plan = buildMiniPlan({ trait_selections: [buildSelection({ catalog_ref: "nowhere" })] });
  const errors = guardPlan(plan);
  assert.ok(errors.some((e) => e.includes("references unknown catalog_ref")));
});
