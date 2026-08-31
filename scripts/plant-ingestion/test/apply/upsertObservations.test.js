import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertObservations } from "../../src/apply/upsertObservations.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildProviderObservation, buildEditorialObservation } from "./fixtures.js";

const catalogIdByRef = new Map([["acer_palmatum_species", "catalog-1"]]);
const sourceRecordIdByRef = new Map([["acer_palmatum_species:perenual:current", "source-1"]]);

test("creates a provider observation, then dedups an identical re-apply (unchanged, no new row)", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const first = await upsertObservations({ client, observations: [buildProviderObservation()], catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(first.created, 1);
  assert.equal(tables.plant_trait_observations.length, 1);

  const second = await upsertObservations({ client, observations: [buildProviderObservation()], catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(tables.plant_trait_observations.length, 1); // append-only, never a duplicate of the same raw_value
});

test("a genuinely new raw_value for the same trait/provider is inserted as an additional row, never an update", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertObservations({ client, observations: [buildProviderObservation({ raw_value: 800 })], catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  const result = await upsertObservations({ client, observations: [buildProviderObservation({ raw_value: 850 })], catalogIdByRef, sourceRecordIdByRef, dryRun: false });

  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(tables.plant_trait_observations.length, 2);
  const values = tables.plant_trait_observations.map((r) => r.raw_value).sort();
  assert.deepEqual(values, [800, 850]);
});

test("an editorial observation (no source record) is handled with a null plant_source_record_id", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertObservations({ client, observations: [buildEditorialObservation()], catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal(tables.plant_trait_observations[0].plant_source_record_id, null);
  assert.equal(tables.plant_trait_observations[0].provider, "editorial");
});

test("a missing parent catalog entry is reported as 'created' without a DB lookup", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertObservations({ client, observations: [buildProviderObservation()], catalogIdByRef: new Map(), sourceRecordIdByRef, dryRun: false });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
  assert.equal(result.idByRef.get("acer_palmatum_species:perenual:height_max_cm"), null);
});

test("a missing parent source record (non-editorial) is reported as 'created' without inserting", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertObservations({ client, observations: [buildProviderObservation()], catalogIdByRef, sourceRecordIdByRef: new Map(), dryRun: false });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

test("dry-run never writes", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertObservations({ client, observations: [buildProviderObservation(), buildEditorialObservation()], catalogIdByRef, sourceRecordIdByRef, dryRun: true });
  assert.equal(result.created, 2);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});
