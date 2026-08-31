import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertTaxa, upsertTaxonNames } from "../../src/apply/upsertTaxonomy.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildTaxon, buildTaxonName } from "./fixtures.js";

test("upsertTaxa dry-run creates nothing and reports a pending (null) id", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertTaxa({ client, taxa: [buildTaxon()], dryRun: true });
  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.idByRef.get("acer_palmatum"), null);
  assert.equal((tables.plant_taxa ?? []).length, 0);
});

test("upsertTaxa real apply inserts a row, then a second identical apply reports unchanged", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const first = await upsertTaxa({ client, taxa: [buildTaxon()], dryRun: false });
  assert.equal(first.created, 1);
  assert.equal(tables.plant_taxa.length, 1);
  const insertedId = first.idByRef.get("acer_palmatum");
  assert.ok(insertedId);

  const second = await upsertTaxa({ client, taxa: [buildTaxon()], dryRun: false });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(second.idByRef.get("acer_palmatum"), insertedId);
  assert.equal(tables.plant_taxa.length, 1); // no duplicate row
});

test("upsertTaxa updates when a comparable field genuinely changed", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_taxa: [{ id: "existing-1", ...buildTaxon(), family: "OldFamily" }],
  });
  const result = await upsertTaxa({ client, taxa: [buildTaxon({ family: "Sapindaceae" })], dryRun: false });
  assert.equal(result.updated, 1);
  assert.equal(result.created, 0);
  assert.equal(tables.plant_taxa[0].family, "Sapindaceae");
  assert.equal(tables.plant_taxa[0].id, "existing-1"); // same row, not a new one
});

test("upsertTaxonNames creates when the parent taxon already exists, and is unchanged on re-apply", async () => {
  const { client } = createFakeSupabaseClient({
    plant_taxa: [{ id: "taxon-1", ...buildTaxon() }],
  });
  const taxonIdByRef = new Map([["acer_palmatum", "taxon-1"]]);

  const first = await upsertTaxonNames({ client, taxonNames: [buildTaxonName()], taxonIdByRef, dryRun: false });
  assert.equal(first.created, 1);

  const second = await upsertTaxonNames({ client, taxonNames: [buildTaxonName()], taxonIdByRef, dryRun: false });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
});

test("upsertTaxonNames treats a missing parent taxon as 'would be created', without a DB lookup", async () => {
  const { client } = createFakeSupabaseClient();
  const result = await upsertTaxonNames({ client, taxonNames: [buildTaxonName()], taxonIdByRef: new Map(), dryRun: false });
  assert.equal(result.created, 1);
  assert.deepEqual(result.errors, []);
});
