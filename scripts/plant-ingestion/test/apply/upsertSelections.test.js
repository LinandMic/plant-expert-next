import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertSelections } from "../../src/apply/upsertSelections.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildSelection } from "./fixtures.js";

const catalogIdByRef = new Map([["acer_palmatum_species", "catalog-1"]]);
const observationIdByRef = new Map([["acer_palmatum_species:perenual:height_max_cm", "obs-1"]]);

test("creates a selection when none exists yet", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal(tables.plant_trait_selections.length, 1);
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-1");
});

test("CRITICAL: never updates an existing selection, even one overridden by manual_resolution pointing elsewhere", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_trait_selections: [
      {
        id: "sel-1",
        plant_catalog_id: "catalog-1",
        trait: "height_max_cm",
        selected_observation_id: "obs-CURATOR-CHOSEN", // a human overrode the automatic pick
        decision_method: "manual_resolution",
        decided_by: "user-uuid",
        note: "Curator preferred the Trefle observation over Perenual.",
      },
    ],
  });

  const result = await upsertSelections({
    client,
    selections: [buildSelection()], // plan still recommends obs-1
    catalogIdByRef,
    observationIdByRef,
    dryRun: false,
  });

  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  const row = tables.plant_trait_selections[0];
  assert.equal(row.selected_observation_id, "obs-CURATOR-CHOSEN"); // untouched
  assert.equal(row.decision_method, "manual_resolution"); // untouched
});

test("a missing parent catalog entry or observation is reported as 'created' without a DB write", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef: new Map(), observationIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
});

test("dry-run never writes", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertSelections({ client, selections: [buildSelection()], catalogIdByRef, observationIdByRef, dryRun: true });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
});
