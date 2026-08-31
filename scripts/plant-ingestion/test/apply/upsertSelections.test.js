import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertSelections } from "../../src/apply/upsertSelections.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildSelection } from "./fixtures.js";

const catalogIdByRef = new Map([["acer_palmatum_species", "catalog-1"]]);
const observationIdByRef = new Map([
  ["acer_palmatum_species:perenual:height_max_cm", "obs-1"],
  ["acer_palmatum_species:trefle:height_max_cm", "obs-2"],
]);

function seedAutomaticSelection(overrides = {}) {
  return {
    id: "sel-1",
    plant_catalog_id: "catalog-1",
    trait: "height_max_cm",
    selected_observation_id: "obs-1",
    decision_method: "provider_observation",
    decided_by: null,
    note: "Initial selection from a deterministic provider observation (dry-run promotion).",
    ...overrides,
  };
}

function seedManualSelection(overrides = {}) {
  return {
    id: "sel-1",
    plant_catalog_id: "catalog-1",
    trait: "height_max_cm",
    selected_observation_id: "obs-CURATOR-CHOSEN",
    decision_method: "manual_resolution",
    decided_by: "user-uuid",
    note: "Curator preferred the Trefle observation over Perenual.",
    ...overrides,
  };
}

// 1. missing -> create
test("1: creates a selection when none exists yet", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 0);
  assert.equal(tables.plant_trait_selections.length, 1);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-1");
});

// 2. same automatic selection -> unchanged
test("2: an existing automatic selection identical to the plan is reported unchanged, no write issued", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedAutomaticSelection()] });
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-1");
});

// 3. different automatic observation -> updated
test("3: an automatic selection whose observation genuinely changed is updated", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedAutomaticSelection({ selected_observation_id: "obs-1" })] });
  const plan = [buildSelection({ selected_observation_ref: "acer_palmatum_species:trefle:height_max_cm" })]; // now recommends obs-2
  const result = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 0);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-2");
  assert.equal(tables.plant_trait_selections[0].id, "sel-1"); // same row, not a duplicate
});

// 4. automatic decision_method changed -> updated
test("4: an automatic selection whose decision_method genuinely changed is updated", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedAutomaticSelection({ decision_method: "provider_observation" })] });
  const plan = [buildSelection({ decision_method: "editorial" })];
  const result = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
  assert.equal(tables.plant_trait_selections[0].decision_method, "editorial");
});

// 5. manual_resolution same -> unchanged
test("5: a manual_resolution selection identical to the plan is reported unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedManualSelection()] });
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.unchanged, 1);
  assert.equal(result.updated, 0);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-CURATOR-CHOSEN");
});

// 6. manual_resolution differing plan -> STILL unchanged (the critical anti-clobber case)
test("6 CRITICAL (anti-clobber): a manual_resolution selection is NEVER updated, even when the plan recommends a different observation", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedManualSelection()] });
  const plan = [buildSelection({ selected_observation_ref: "acer_palmatum_species:trefle:height_max_cm", decision_method: "provider_observation" })];
  const result = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-CURATOR-CHOSEN");
  assert.equal(tables.plant_trait_selections[0].decision_method, "manual_resolution");
});

// 7. decided_by/note manual preserved
test("7: decided_by and note of a manual_resolution row are preserved exactly", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_trait_selections: [seedManualSelection({ decided_by: "curator-uuid-42", note: "Chose Trefle because Perenual was stale." })],
  });
  await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(tables.plant_trait_selections[0].decided_by, "curator-uuid-42");
  assert.equal(tables.plant_trait_selections[0].note, "Chose Trefle because Perenual was stale.");
});

// 8. dry-run automatic difference -> updated count mais aucune écriture
test("8: dry-run reports 'updated' for a genuine automatic difference but writes nothing", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedAutomaticSelection({ selected_observation_id: "obs-1" })] });
  const plan = [buildSelection({ selected_observation_ref: "acer_palmatum_species:trefle:height_max_cm" })];
  const result = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: true });
  assert.equal(result.updated, 1);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-1"); // untouched
});

// 9. reapply après update -> unchanged
test("9: re-applying the same (now-updated) plan a second time reports unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_trait_selections: [seedAutomaticSelection({ selected_observation_id: "obs-1" })] });
  const plan = [buildSelection({ selected_observation_ref: "acer_palmatum_species:trefle:height_max_cm" })];
  const first = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(first.updated, 1);

  const second = await upsertSelections({ client, selections: plan, catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(tables.plant_trait_selections.length, 1); // no duplicate row
});

test("a missing parent catalog entry or observation is reported as 'created' without a DB write", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef: new Map(), observationIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
});

test("dry-run never writes on a fresh create", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: true });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
});
