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
