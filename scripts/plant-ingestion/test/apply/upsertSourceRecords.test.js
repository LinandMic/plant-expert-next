import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertSourceRecords } from "../../src/apply/upsertSourceRecords.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildSourceRecord } from "./fixtures.js";

const catalogIdByRef = new Map([["acer_palmatum_species", "catalog-1"]]);

test("creates a current source record, then reports unchanged on identical re-apply", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const first = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord()], catalogIdByRef, dryRun: false });
  assert.equal(first.created, 1);
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_source_records[0].superseded_at ?? null, null);

  const second = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord()], catalogIdByRef, dryRun: false });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(tables.plant_source_records.length, 1); // no duplicate current row
});

test("a genuine data change supersedes the old current row and inserts a new one", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "matched" })], catalogIdByRef, dryRun: false });

  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "updated" })], catalogIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
  assert.equal(tables.plant_source_records.length, 2);

  const current = tables.plant_source_records.filter((r) => !r.superseded_at);
  const superseded = tables.plant_source_records.filter((r) => r.superseded_at);
  assert.equal(current.length, 1);
  assert.equal(superseded.length, 1);
  assert.equal(current[0].provider_status, "updated");
  assert.equal(superseded[0].provider_status, "matched");
});

test("re-applying after a supersession is idempotent (unchanged, no further duplication)", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "matched" })], catalogIdByRef, dryRun: false });
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "updated" })], catalogIdByRef, dryRun: false });

  const third = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "updated" })], catalogIdByRef, dryRun: false });
  assert.equal(third.unchanged, 1);
  assert.equal(third.updated, 0);
  assert.equal(tables.plant_source_records.length, 2); // still just one supersession event
});

test("dry-run never supersedes or inserts", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "matched" })], catalogIdByRef, dryRun: false });

  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "updated" })], catalogIdByRef, dryRun: true });
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_source_records[0].provider_status, "matched");
});

// ===========================================================================
// idByRef correctness on a dry-run "would update" — the fix for the
// cascade bug found against real production data: a genuine change in
// dry-run must NOT null out idByRef, because nothing was actually
// superseded — the existing row is still the real current row.
// ===========================================================================
test("CRITICAL: a genuine change in dry-run reports updated=1 with zero writes, and idByRef still points at the existing row's real id", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const seeded = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "matched" })], catalogIdByRef, dryRun: false });
  const existingId = seeded.idByRef.get("acer_palmatum_species:perenual:current");
  assert.ok(existingId);

  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_status: "updated" })], catalogIdByRef, dryRun: true });

  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(result.errors, []);
  // Zero writes: still exactly the one row from the seed, untouched.
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_source_records[0].provider_status, "matched");
  assert.equal(tables.plant_source_records[0].superseded_at ?? null, null);
  // The fix: idByRef points at the existing row's real id, not null.
  assert.equal(result.idByRef.get("acer_palmatum_species:perenual:current"), existingId);
});

// ===========================================================================
// retrieved_at is provenance/audit, not content — it must never by itself
// turn an otherwise-identical source record into a "genuine change".
// ===========================================================================

// A. DB and plan identical except retrieved_at -> unchanged
test("A: retrieved_at alone differing between DB and plan is reported unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ retrieved_at: "2026-01-01T00:00:00.000Z" })], catalogIdByRef, dryRun: false });

  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ retrieved_at: "2026-06-15T12:30:00.000Z" })], catalogIdByRef, dryRun: false });
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_source_records.length, 1); // no supersession
});

// B. provider_record_id different -> updated
test("B: a genuinely different provider_record_id triggers an update", async () => {
  const { client } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_record_id: "320245" })], catalogIdByRef, dryRun: false });
  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ provider_record_id: "999999" })], catalogIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
});

// C. metadata genuinely different -> updated
test("C: a genuinely different metadata payload triggers an update", async () => {
  const { client } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ metadata: { candidates: 1 } })], catalogIdByRef, dryRun: false });
  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ metadata: { candidates: 4 } })], catalogIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
});

// D. source_url different -> updated
test("D: a genuinely different source_url triggers an update", async () => {
  const { client } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ source_url: "https://perenual.com/species/320245" })], catalogIdByRef, dryRun: false });
  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ source_url: "https://perenual.com/species/999999" })], catalogIdByRef, dryRun: false });
  assert.equal(result.updated, 1);
});

// E. retrieved_at different AND another business field different -> still updated (retrieved_at doesn't mask a real change)
test("E: retrieved_at differing alongside a genuine business-field change still reports updated", async () => {
  const { client } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord({ retrieved_at: "2026-01-01T00:00:00.000Z", provider_status: "matched" })], catalogIdByRef, dryRun: false });
  const result = await upsertSourceRecords({
    client,
    sourceRecords: [buildSourceRecord({ retrieved_at: "2026-06-15T12:30:00.000Z", provider_status: "updated" })],
    catalogIdByRef,
    dryRun: false,
  });
  assert.equal(result.updated, 1);
});

// F. exact re-application -> unchanged
test("F: re-applying the exact same plan is unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord()], catalogIdByRef, dryRun: false });
  const result = await upsertSourceRecords({ client, sourceRecords: [buildSourceRecord()], catalogIdByRef, dryRun: false });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(tables.plant_source_records.length, 1);
});
