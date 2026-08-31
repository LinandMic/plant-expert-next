import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPlan } from "../../src/apply/applyPlan.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildMiniPlan, buildCatalogEntry, buildTaxon } from "./fixtures.js";

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

test("sanity: every step of a clean run returns a well-shaped, status:\"ok\" report object", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const plan = buildMiniPlan();
  const report = await applyPlan({ client, plan, dryRun: false });
  assert.equal(report.totals.errors, 0);
  for (const step of Object.values(report.steps)) {
    assert.equal(step.status, "ok");
    assert.ok("created" in step && "unchanged" in step && Array.isArray(step.errors));
  }
});

// ===========================================================================
// Dependency-aware error propagation (real FK graph, see applyPlan.js's own
// file-level comment): a plant_taxa failure stops everything; a
// plant_catalog failure blocks source_records/observations/selections; a
// plant_source_records failure blocks observations/selections; a
// plant_trait_observations failure blocks selections only; a
// plant_taxon_names failure blocks nothing (nothing FKs to it).
// ===========================================================================

// A. taxa error -> downstream skipped
test("A: a plant_taxa failure stops the whole pipeline — every other table is reported skipped", async () => {
  const { client, tables } = createFakeSupabaseClient({}, { failOn: { plant_taxa: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(report.ok, false);
  assert.equal(report.steps.taxa.status, "ok"); // it ran — it just failed
  assert.ok(report.steps.taxa.errors.length > 0);
  for (const table of ["taxon_names", "catalog_entries", "source_records", "trait_observations", "trait_selections"]) {
    assert.equal(report.steps[table].status, "skipped");
    assert.match(report.steps[table].reason, /plant_taxa/);
    assert.equal(report.steps[table].created, 0);
    assert.equal(report.steps[table].updated, 0);
    assert.equal(report.steps[table].unchanged, 0);
  }
  assert.equal(report.totals.skipped, 5);
  assert.equal((tables.plant_catalog ?? []).length, 0);
});

// B. catalog error -> source/obs/selections skipped
test("B: a plant_catalog failure blocks source_records/observations/selections, but taxon_names (not FK-dependent) already ran fine", async () => {
  const { client, tables } = createFakeSupabaseClient({}, { failOn: { plant_catalog: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(report.ok, false);
  assert.equal(report.steps.taxa.status, "ok");
  assert.equal(report.steps.taxon_names.status, "ok");
  assert.equal(report.steps.taxon_names.created, 1); // ran normally, unaffected by the later catalog failure
  assert.ok(report.steps.catalog_entries.errors.length > 0);
  for (const table of ["source_records", "trait_observations", "trait_selections"]) {
    assert.equal(report.steps[table].status, "skipped");
    assert.match(report.steps[table].reason, /plant_catalog/);
  }
  assert.equal((tables.plant_source_records ?? []).length, 0);
});

// C. source error -> dependent downstream skipped
test("C: a plant_source_records failure blocks observations/selections", async () => {
  const { client, tables } = createFakeSupabaseClient({}, { failOn: { plant_source_records: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(report.ok, false);
  assert.equal(report.steps.catalog_entries.status, "ok");
  assert.ok(report.steps.source_records.errors.length > 0);
  for (const table of ["trait_observations", "trait_selections"]) {
    assert.equal(report.steps[table].status, "skipped");
    assert.match(report.steps[table].reason, /plant_source_records/);
  }
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

// D. observation error -> selections skipped
test("D: a plant_trait_observations failure blocks selections only", async () => {
  const { client, tables } = createFakeSupabaseClient({}, { failOn: { plant_trait_observations: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(report.ok, false);
  assert.equal(report.steps.source_records.status, "ok");
  assert.ok(report.steps.trait_observations.errors.length > 0);
  assert.equal(report.steps.trait_selections.status, "skipped");
  assert.match(report.steps.trait_selections.reason, /plant_trait_observations/);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
});

// E. independent step allowed when its FK doesn't depend on the failing step
test("E: a plant_taxon_names failure blocks nothing — catalog_entries/source_records/observations/selections all still run", async () => {
  const { client, tables } = createFakeSupabaseClient({}, { failOn: { plant_taxon_names: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  assert.equal(report.ok, false); // taxon_names itself has an error
  assert.equal(report.totals.skipped, 0); // nothing was skipped
  assert.ok(report.steps.taxon_names.errors.length > 0);
  for (const table of ["catalog_entries", "source_records", "trait_observations", "trait_selections"]) {
    assert.equal(report.steps[table].status, "ok");
  }
  assert.equal(tables.plant_catalog.length, 1);
  assert.equal(tables.plant_source_records.length, 1);
  assert.equal(tables.plant_trait_observations.length, 2);
  assert.equal(tables.plant_trait_selections.length, 1);
});

// F + G. skipped steps are clearly reported and never counted as
// created/updated/unchanged; totals are correct.
test("F+G: totals never count a skipped step as created/updated/unchanged, and totals.errors/skipped are accurate", async () => {
  const { client } = createFakeSupabaseClient({}, { failOn: { plant_catalog: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });

  // taxa(created=1) + taxon_names(created=1) + catalog_entries(created=1, failed) = 3;
  // source_records/observations/selections are skipped, contributing 0.
  assert.equal(report.totals.created, 1 + 1 + 1);
  assert.equal(report.totals.updated, 0);
  assert.equal(report.totals.unchanged, 0);
  assert.equal(report.totals.errors, 1);
  assert.equal(report.totals.skipped, 3);
});

// H. report.ok is false whenever any step has an error
test("H: report.ok is false whenever any step reports an error, even a single one deep in the pipeline", async () => {
  const { client } = createFakeSupabaseClient({}, { failOn: { plant_trait_observations: { insert: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: false });
  assert.equal(report.ok, false);
});

// I. re-run after the underlying issue is resolved completes the pipeline
test("I: re-running after the parent failure is resolved completes the previously-skipped tables, without duplicating what already succeeded", async () => {
  const first = createFakeSupabaseClient({}, { failOn: { plant_catalog: { insert: true } } });
  const plan = buildMiniPlan();
  const firstReport = await applyPlan({ client: first.client, plan, dryRun: false });
  assert.equal(firstReport.ok, false);
  assert.equal(first.tables.plant_taxa.length, 1);
  assert.equal((first.tables.plant_catalog ?? []).length, 0);

  // Same underlying data, but the transient failure is gone this time.
  const second = createFakeSupabaseClient(first.tables);
  const secondReport = await applyPlan({ client: second.client, plan, dryRun: false });

  assert.equal(secondReport.ok, true);
  assert.equal(secondReport.totals.skipped, 0);
  assert.equal(second.tables.plant_taxa.length, 1); // taxa was already there — unchanged, not duplicated
  assert.equal(second.tables.plant_catalog.length, 1); // now created for real
  assert.equal(second.tables.plant_source_records.length, 1);
  assert.equal(second.tables.plant_trait_observations.length, 2);
  assert.equal(second.tables.plant_trait_selections.length, 1);
});

// dry-run must apply the exact same dependency-skip logic — it never
// pretends downstream tables could safely be applied when a parent read
// itself already failed.
test("dry-run also skips downstream tables when a parent step fails, instead of reporting hypothetical counts for them", async () => {
  // The taxon must already exist so upsertTaxa resolves a REAL id even in
  // dry-run (a fresh, all-empty dry-run cascades every ref to null and
  // never reaches plant_catalog's own lookup at all — that's not what this
  // test is exercising).
  const seededTaxon = { id: "existing-taxon-1", ...buildTaxon() };
  const { client } = createFakeSupabaseClient({ plant_taxa: [seededTaxon] }, { failOn: { plant_catalog: { select: true } } });
  const report = await applyPlan({ client, plan: buildMiniPlan(), dryRun: true });

  assert.equal(report.dryRun, true);
  assert.equal(report.ok, false);
  assert.ok(report.steps.catalog_entries.errors.length > 0);
  for (const table of ["source_records", "trait_observations", "trait_selections"]) {
    assert.equal(report.steps[table].status, "skipped");
  }
});
