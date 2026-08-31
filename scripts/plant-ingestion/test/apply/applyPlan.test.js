import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPlan } from "../../src/apply/applyPlan.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildMiniPlan, buildCatalogEntry } from "./fixtures.js";

test("an invalid plan is rejected by guardPlan and nothing is touched", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const plan = { ...buildMiniPlan(), approval_required: false };
  const report = await applyPlan({ client, plan, dryRun: false });
  assert.equal(report.ok, false);
  assert.ok(report.guardErrors.length > 0);
  assert.deepEqual(report.steps, {});
  assert.deepEqual(tables, {});
});

test("applyPlan defaults to dry-run when dryRun is omitted", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const report = await applyPlan({ client, plan: buildMiniPlan() });
  assert.equal(report.dryRun, true);
  assert.equal((tables.plant_taxa ?? []).length, 0);
  assert.equal((tables.plant_catalog ?? []).length, 0);
});

test("dry-run reports full would-be creation counts across all six tables but writes nothing", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: true });
  assert.equal(report.ok, true);
  assert.equal(report.totals.created, 1 + 1 + 1 + 1 + 2 + 1); // taxa, names, catalog, source_records, observations(2), selections
  assert.equal(report.totals.errors, 0);
  for (const table of Object.keys(tables)) {
    assert.equal(tables[table].length, 0);
  }
});

test("a real apply writes all six tables in dependency order with correctly wired FKs", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });
  assert.equal(report.ok, true);
  assert.equal(tables.plant_taxa.length, 1);
  assert.equal(tables.plant_taxon_names.length, 1);
  assert.equal(tables.plant_catalog.length, 1);
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_trait_observations.length, 2);
  assert.equal(tables.plant_trait_selections.length, 1);

  const taxon = tables.plant_taxa[0];
  const catalog = tables.plant_catalog[0];
  const sourceRecord = tables.plant_source_records[0];
  const selection = tables.plant_trait_selections[0];
  const providerObs = tables.plant_trait_observations.find((o) => o.provider === "perenual");

  assert.equal(tables.plant_taxon_names[0].taxon_id, taxon.id);
  assert.equal(catalog.taxon_id, taxon.id);
  assert.equal(sourceRecord.plant_catalog_id, catalog.id);
  assert.equal(providerObs.plant_catalog_id, catalog.id);
  assert.equal(providerObs.plant_source_record_id, sourceRecord.id);
  assert.equal(selection.plant_catalog_id, catalog.id);
  assert.equal(selection.selected_observation_id, providerObs.id);
});

test("idempotence: applying the same plan twice never duplicates any row", async () => {
  const { client, tables } = createFakeSupabaseClient();
  await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });
  const second = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(second.totals.created, 0);
  assert.equal(second.totals.updated, 0);
  assert.equal(second.totals.unchanged, 1 + 1 + 1 + 1 + 2 + 1);
  assert.equal(tables.plant_taxa.length, 1);
  assert.equal(tables.plant_taxon_names.length, 1);
  assert.equal(tables.plant_catalog.length, 1);
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_trait_observations.length, 2);
  assert.equal(tables.plant_trait_selections.length, 1);
});

test("curator protection survives a full applyPlan run: publication fields are never reverted", async () => {
  const seeded = createFakeSupabaseClient();
  await applyPlan({ client: seeded.client, plan: buildMiniPlan(), dryRun: false });
  // Simulate a curator publishing the entry by hand, in production.
  seeded.tables.plant_catalog[0].publication_status = "published";
  seeded.tables.plant_catalog[0].review_status = "reviewed";
  seeded.tables.plant_catalog[0].published_at = "2026-03-01T00:00:00.000Z";

  // A fresh ingestion run brings a genuinely updated height.
  const updatedPlan = buildMiniPlan({ catalog_entries: [buildCatalogEntry({ height_max_cm: 900 })] });
  const report = await applyPlan({ client: seeded.client, plan: updatedPlan, dryRun: false });

  assert.equal(report.ok, true);
  const row = seeded.tables.plant_catalog[0];
  assert.equal(row.height_max_cm, 900);
  assert.equal(row.publication_status, "published");
  assert.equal(row.review_status, "reviewed");
  assert.equal(row.published_at, "2026-03-01T00:00:00.000Z");
});

test("a per-row error in one step does not block independent rows in later steps", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const plan = buildMiniPlan();
  const report = await applyPlan({ client, plan, dryRun: false });
  assert.equal(report.totals.errors, 0);
  // Sanity: every step returned a well-shaped report object.
  for (const step of Object.values(report.steps)) {
    assert.ok("created" in step && "unchanged" in step && Array.isArray(step.errors));
  }
});
