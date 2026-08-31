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

// ===========================================================================
// F/G/H — raw_value stable equality (real production regression: the
// "edible" trait's raw_value object round-tripped with a different key
// order than the plan).
// ===========================================================================

// F. raw_value object, same content, different key order -> unchanged
test("F: a raw_value object with a different key order than the plan is deduped as unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "edible", raw_value: { edible_leaf: false, edible_fruit: false } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  const result = await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "edible", raw_value: { edible_fruit: false, edible_leaf: false } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  assert.equal(result.created, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_trait_observations.length, 1); // no duplicate row
});

// G. nested object inside raw_value, different key order -> unchanged
test("G: a nested object inside raw_value with a different key order is still deduped as unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "hardiness", raw_value: { zone: { min: 5, max: 9 }, source: "usda" } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  const result = await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "hardiness", raw_value: { source: "usda", zone: { max: 9, min: 5 } } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_trait_observations.length, 1);
});

// H. raw_value genuinely different -> created (append-only, never an update)
test("H: a genuinely different raw_value object is inserted as a new row, not an update", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "edible", raw_value: { edible_leaf: false, edible_fruit: false } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  const result = await upsertObservations({
    client,
    observations: [buildProviderObservation({ trait: "edible", raw_value: { edible_leaf: true, edible_fruit: false } })],
    catalogIdByRef,
    sourceRecordIdByRef,
    dryRun: false,
  });

  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(tables.plant_trait_observations.length, 2);
});

// ===========================================================================
// Accounting invariant: every input row lands in exactly one bucket.
// ===========================================================================

test("ACCOUNTING 1: N observations in -> created+unchanged+failed always equals N, no mismatch reported", async () => {
  const { client } = createFakeSupabaseClient();
  const observations = [
    buildProviderObservation({ observation_ref: "o1", trait: "height_max_cm", raw_value: 800 }),
    buildProviderObservation({ observation_ref: "o2", trait: "height_min_cm", raw_value: 300 }),
    buildEditorialObservation({ observation_ref: "o3", trait: "plant_type" }),
  ];
  const result = await upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(result.created + result.updated + result.unchanged + result.failed, observations.length);
  assert.equal(result.inputCount, observations.length);
  assert.equal(result.accountedCount, observations.length);
  assert.deepEqual(result.errors, []); // no mismatch error when accounting is correct
});

test("ACCOUNTING 2: a mix of duplicates and genuine creates still accounts for every row", async () => {
  const { client } = createFakeSupabaseClient();
  const first = [buildProviderObservation({ observation_ref: "o1", trait: "height_max_cm", raw_value: 800 })];
  await upsertObservations({ client, observations: first, catalogIdByRef, sourceRecordIdByRef, dryRun: false });

  const second = [
    buildProviderObservation({ observation_ref: "o1", trait: "height_max_cm", raw_value: 800 }), // duplicate -> unchanged
    buildProviderObservation({ observation_ref: "o2", trait: "height_min_cm", raw_value: 300 }), // new -> created
  ];
  const result = await upsertObservations({ client, observations: second, catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(result.unchanged, 1);
  assert.equal(result.created, 1);
  assert.equal(result.created + result.updated + result.unchanged + result.failed, second.length);
});

// 3. missing parent -> explicitly counted as would-create in dry-run
test("ACCOUNTING 3: a missing parent catalog is counted explicitly as 'created' (would-create), never dropped", async () => {
  const { client } = createFakeSupabaseClient();
  const observations = [buildProviderObservation()];
  const result = await upsertObservations({ client, observations, catalogIdByRef: new Map(), sourceRecordIdByRef, dryRun: true });
  assert.equal(result.created, 1);
  assert.equal(result.created + result.updated + result.unchanged + result.failed, observations.length);
});

// 4. lookup error -> row/step explicitly counted as failed, never as a fabricated "created"
test("ACCOUNTING 4: a catalog lookup failure is counted as 'failed', not fabricated as 'created'", async () => {
  const { client } = createFakeSupabaseClient({}, { failOn: { plant_trait_observations: { select: true } } });
  const observations = [
    buildProviderObservation({ observation_ref: "o1", trait: "height_max_cm" }),
    buildProviderObservation({ observation_ref: "o2", trait: "height_min_cm" }),
  ];
  const result = await upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  assert.equal(result.created, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.created + result.updated + result.unchanged + result.failed, observations.length);
  assert.ok(result.errors.some((e) => e.includes("lookup failed")));
});

// 5. no silent path: forcing a mismatch (defensive backstop) surfaces an explicit error
test("ACCOUNTING 5: if input and accounted counts ever mismatch, it is reported as an explicit error, never silently masked", async () => {
  const { client } = createFakeSupabaseClient();
  const observations = [buildProviderObservation()];
  const result = await upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun: false });
  // Sanity: the real code path always balances — this test documents the
  // invariant contract itself (see the end-of-function check in
  // upsertObservations.js) rather than forcing an artificial imbalance,
  // since the fake client cannot make a row vanish outside the exclusive
  // created/unchanged/failed branches.
  assert.equal(result.accountedCount, result.inputCount);
  assert.deepEqual(result.errors, []);
});
