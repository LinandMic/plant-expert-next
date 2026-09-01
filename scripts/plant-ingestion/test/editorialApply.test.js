import { test } from "node:test";
import assert from "node:assert/strict";

import { buildEditorialPlan } from "../src/editorial/buildEditorialPlan.js";
import { applyEditorialPlan } from "../src/editorial/applyEditorialPlan.js";
import { promoteCatalogTrait } from "../src/editorial/promoteCatalogTrait.js";
import { verifyEditorialPlan } from "../src/editorial/verifyEditorialPlan.js";
import { createFakeSupabaseClient } from "./apply/fakeSupabaseClient.js";

// Structural test fixtures only — no real horticultural claim is made or
// implied by any value below (spec: "AUCUNE DONNÉE HORTICOLE RÉELLE").
function validInput(overrides = {}) {
  return {
    catalog_ref: "acer_palmatum_species",
    trait: "sun",
    raw_value: ["full_sun"],
    normalized_value: ["full_sun"],
    source: {
      title: "Example Horticultural Reference",
      publisher: "Example Publisher",
      url: "https://example.invalid/reference",
      license: "CC-BY-4.0",
    },
    review: { note: "Structural test fixture, not a real curation decision.", decided_by: null },
    ...overrides,
  };
}

const catalogSlugByRef = new Map([["acer_palmatum_species", "acer-palmatum"]]);

function seedCatalog(overrides = {}) {
  return { id: "catalog-1", slug: "acer-palmatum", sun: null, plant_type: null, evergreen: null, height_max_cm: null, flowering_months: null, publication_status: "draft", ...overrides };
}

// 1. dry-run zéro write
test("1: dry-run performs real reads but writes nothing at all", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: true });
  assert.equal(report.ok, true);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
  assert.equal(tables.plant_catalog[0].sun, null); // untouched
});

// 2. insert editorial observation
test("2: apply inserts a real editorial observation row", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.ok, true);
  assert.equal(tables.plant_trait_observations.length, 1);
  assert.equal(tables.plant_trait_observations[0].provider, "editorial");
  assert.equal(tables.plant_trait_observations[0].source_scope, "editorial");
});

// 3. source_record jamais créé
test("3: apply never creates a plant_source_records row for an editorial observation", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal((tables.plant_source_records ?? []).length, 0);
  assert.equal(tables.plant_trait_observations[0].plant_source_record_id, null);
});

// 4. manual_resolution créée
test("4: apply creates a manual_resolution selection pointing at the new observation", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(tables.plant_trait_selections.length, 1);
  assert.equal(tables.plant_trait_selections[0].decision_method, "manual_resolution");
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, tables.plant_trait_observations[0].id);
});

// 5. promotion catalog correcte
test("5: apply promotes normalized_value into the correct plant_catalog column", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.deepEqual(tables.plant_catalog[0].sun, ["full_sun"]);
  assert.equal(report.totals.catalog_promotions.updated, 1);
});

// 6. sun array promotion
test("6: sun (array trait) promotes correctly", async () => {
  const plan = buildEditorialPlan([validInput({ trait: "sun", raw_value: ["partial_sun", "full_sun"], normalized_value: ["partial_sun", "full_sun"] })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.deepEqual(tables.plant_catalog[0].sun, ["partial_sun", "full_sun"]);
});

// 7. boolean promotion
test("7: evergreen (boolean trait) promotes correctly", async () => {
  const plan = buildEditorialPlan([validInput({ trait: "evergreen", raw_value: true, normalized_value: true })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(tables.plant_catalog[0].evergreen, true);
});

// 8. numeric promotion
test("8: height_max_cm (numeric trait) promotes correctly", async () => {
  const plan = buildEditorialPlan([validInput({ trait: "height_max_cm", raw_value: 150, normalized_value: 150 })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(tables.plant_catalog[0].height_max_cm, 150);
});

// 9. flowering_months promotion
test("9: flowering_months (int array trait) promotes correctly", async () => {
  const plan = buildEditorialPlan([validInput({ trait: "flowering_months", raw_value: [4, 5], normalized_value: [4, 5] })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.deepEqual(tables.plant_catalog[0].flowering_months, [4, 5]);
});

// 10. existing identical observation -> unchanged
test("10: re-applying with an identical existing editorial observation reports unchanged, no duplicate row", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  const report2 = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report2.totals.editorial_observations.unchanged, 1);
  assert.equal(tables.plant_trait_observations.length, 1); // no duplicate
});

// 11. conflicting observation -> conflict is surfaced (a genuine new value is a NEW append-only row, never an update)
test("11: a second editorial observation for the same trait with a DIFFERENT value is created as a new row (append-only), never overwrites the first", async () => {
  const plan1 = buildEditorialPlan([validInput({ raw_value: ["full_sun"], normalized_value: ["full_sun"] })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan: plan1, catalogSlugByRef, dryRun: false });

  const plan2 = buildEditorialPlan([validInput({ raw_value: ["partial_sun"], normalized_value: ["partial_sun"] })]);
  const report2 = await applyEditorialPlan({ client, plan: plan2, catalogSlugByRef, dryRun: false });
  assert.equal(report2.totals.editorial_observations.created, 1);
  assert.equal(tables.plant_trait_observations.length, 2); // both preserved, append-only
});

// 12. existing identical manual_resolution -> unchanged
test("12: re-applying with an identical existing manual_resolution reports unchanged", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  const report2 = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report2.totals.manual_selections.unchanged, 1);
  assert.equal(tables.plant_trait_selections.length, 1);
});

// 13. existing different manual_resolution -> conflict
test("13 CRITICAL: an existing manual_resolution pointing at a DIFFERENT value is reported as a conflict, never overwritten", async () => {
  const existingObs = { id: "obs-curator-chosen", plant_catalog_id: "catalog-1", trait: "sun", provider: "editorial", raw_value: ["shade"], normalized_value: ["shade"] };
  const existingSel = { id: "sel-1", plant_catalog_id: "catalog-1", trait: "sun", decision_method: "manual_resolution", selected_observation_id: "obs-curator-chosen" };
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [seedCatalog({ sun: ["shade"] })],
    plant_trait_observations: [existingObs],
    plant_trait_selections: [existingSel],
  });

  const plan = buildEditorialPlan([validInput({ normalized_value: ["full_sun"] })]); // proposes a different value
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });

  assert.equal(report.entries[0].selection.status, "conflict");
  assert.equal(tables.plant_trait_selections.length, 1); // untouched
  assert.equal(tables.plant_trait_selections[0].selected_observation_id, "obs-curator-chosen"); // untouched
});

// 14. conflict selection -> no catalog promotion
test("14: a manual_resolution conflict blocks catalog promotion entirely", async () => {
  const existingObs = { id: "obs-curator-chosen", plant_catalog_id: "catalog-1", trait: "sun", provider: "editorial", raw_value: ["shade"], normalized_value: ["shade"] };
  const existingSel = { id: "sel-1", plant_catalog_id: "catalog-1", trait: "sun", decision_method: "manual_resolution", selected_observation_id: "obs-curator-chosen" };
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [seedCatalog({ sun: ["shade"] })],
    plant_trait_observations: [existingObs],
    plant_trait_selections: [existingSel],
  });

  const plan = buildEditorialPlan([validInput({ normalized_value: ["full_sun"] })]);
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });

  assert.equal(report.entries[0].promotion, null); // never attempted
  assert.deepEqual(tables.plant_catalog[0].sun, ["shade"]); // untouched, still the protected value
  assert.equal(report.totals.catalog_promotions.skipped, 1);
});

// 15. rejected observation -> no promotion
test("15: an observation with review_status=\"rejected\" is never promoted", async () => {
  const plan = buildEditorialPlan([validInput()]);
  plan.editorial_observations[0].review_status = "rejected"; // simulate a corrupted/hand-edited plan
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].errors.length, 1);
  assert.match(report.entries[0].errors[0], /review_status/);
  assert.equal(tables.plant_catalog[0].sun, null);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

// 16. unreviewed observation -> no promotion
test("16: an observation with review_status=\"unreviewed\" is never promoted", async () => {
  const plan = buildEditorialPlan([validInput()]);
  plan.editorial_observations[0].review_status = "unreviewed";
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].errors.length, 1);
  assert.equal(tables.plant_catalog[0].sun, null);
});

// 17. wrong trait FK -> rejected
test("17: a selection whose trait does not match its observation's trait is rejected before any write", async () => {
  const plan = buildEditorialPlan([validInput()]);
  plan.manual_selections[0].trait = "plant_type"; // simulate corruption: mismatched trait
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].errors.length, 1);
  assert.match(report.entries[0].errors[0], /trait mismatch/);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

// 18. wrong catalog FK -> rejected
test("18: a selection whose catalog_ref does not match its observation's catalog_ref is rejected before any write", async () => {
  const plan = buildEditorialPlan([validInput()]);
  plan.manual_selections[0].catalog_ref = "some_other_species";
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].errors.length, 1);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

// 19. missing catalog_ref -> error
test("19: a catalog_ref with no known slug (or no matching plant_catalog row) produces a clean error, no write", async () => {
  const plan = buildEditorialPlan([validInput({ catalog_ref: "unknown_species_species" })]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [] });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.ok, false);
  assert.equal(report.entries[0].errors.length, 1);
  assert.match(report.entries[0].errors[0], /no slug known/);
  assert.equal((tables.plant_trait_observations ?? []).length, 0);
});

// 20. partial failure observation -> no selection/promotion
test("20: an observation write failure blocks the selection and the promotion", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] }, { failOn: { plant_trait_observations: { select: "forced observation lookup failure" } } });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].observation.status, "failed");
  assert.equal(report.entries[0].selection, null);
  assert.equal(report.entries[0].promotion, null);
  assert.equal((tables.plant_trait_selections ?? []).length, 0);
  assert.equal(tables.plant_catalog[0].sun, null);
});

// 21. partial failure selection -> no promotion
test("21: a selection write failure blocks the promotion, but the observation was already written", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] }, { failOn: { plant_trait_selections: { insert: "forced selection insert failure" } } });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].observation.status, "created");
  assert.equal(tables.plant_trait_observations.length, 1);
  assert.equal(report.entries[0].selection.status, "failed");
  assert.equal(report.entries[0].promotion, null);
  assert.equal(tables.plant_catalog[0].sun, null);
});

// 22. catalog promotion failure surfaced
test("22: a catalog promotion write failure is surfaced explicitly, not masked", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] }, { failOn: { plant_catalog: { update: "forced promotion failure" } } });
  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(report.entries[0].observation.status, "created");
  assert.equal(report.entries[0].selection.status, "created");
  assert.equal(report.entries[0].promotion.status, "failed");
  assert.match(report.entries[0].promotion.errors[0], /forced promotion failure/);
  assert.equal(report.ok, false);
  assert.equal(tables.plant_catalog[0].sun, null); // never actually written
});

// 23. publication_status unchanged
test("23: apply never touches plant_catalog.publication_status", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog({ publication_status: "published" })] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(tables.plant_catalog[0].publication_status, "published");
});

// 24. provider observations untouched
test("24: apply never touches an existing provider observation or its selection", async () => {
  const providerObs = { id: "obs-provider-1", plant_catalog_id: "catalog-1", trait: "sun", provider: "trefle", raw_value: ["full_sun"], normalized_value: ["full_sun"] };
  const providerSel = { id: "sel-provider-1", plant_catalog_id: "catalog-1", trait: "plant_type", decision_method: "provider_observation", selected_observation_id: "obs-other" };
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [seedCatalog()],
    plant_trait_observations: [providerObs],
    plant_trait_selections: [providerSel],
  });
  const plan = buildEditorialPlan([validInput()]); // targets "sun", same trait, but provider="editorial"
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });

  const untouchedObs = tables.plant_trait_observations.find((o) => o.id === "obs-provider-1");
  assert.deepEqual(untouchedObs, providerObs);
  const untouchedSel = tables.plant_trait_selections.find((s) => s.id === "sel-provider-1");
  assert.deepEqual(untouchedSel, providerSel);
});

// 25. idempotence second apply
test("25: applying the same plan twice is fully idempotent (second run: all unchanged, no duplicates, same catalog value)", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });

  const first = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(first.ok, true);

  const second = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });
  assert.equal(second.ok, true);
  assert.equal(second.totals.editorial_observations.unchanged, 1);
  assert.equal(second.totals.manual_selections.unchanged, 1);
  assert.equal(second.totals.catalog_promotions.unchanged, 1);
  assert.equal(tables.plant_trait_observations.length, 1);
  assert.equal(tables.plant_trait_selections.length, 1);
  assert.deepEqual(tables.plant_catalog[0].sun, ["full_sun"]);
});

// Additional direct coverage of promoteCatalogTrait() in isolation.

test("promoteCatalogTrait: never touches any column other than the target trait", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog({ plant_type: "shrub", publication_status: "published" })] });
  await promoteCatalogTrait({ client, catalogId: "catalog-1", trait: "sun", normalizedValue: ["full_sun"], dryRun: false });
  assert.equal(tables.plant_catalog[0].plant_type, "shrub");
  assert.equal(tables.plant_catalog[0].publication_status, "published");
  assert.deepEqual(tables.plant_catalog[0].sun, ["full_sun"]);
});

test("promoteCatalogTrait: dry-run never writes", async () => {
  const { client, tables } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const result = await promoteCatalogTrait({ client, catalogId: "catalog-1", trait: "sun", normalizedValue: ["full_sun"], dryRun: true });
  assert.equal(result.status, "updated"); // would update
  assert.equal(tables.plant_catalog[0].sun, null); // but nothing written
});

// verifyEditorialPlan coverage.

test("verifyEditorialPlan: passes on a correctly-applied plan", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });

  const result = await verifyEditorialPlan({ client, plan, catalogSlugByRef });
  assert.equal(result.ok, true);
  assert.ok(result.checks.some((c) => c.message.includes("plant_catalog.sun matches")));
});

test("verifyEditorialPlan: fails cleanly when the plan was never applied", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client } = createFakeSupabaseClient({ plant_catalog: [seedCatalog()] });
  const result = await verifyEditorialPlan({ client, plan, catalogSlugByRef });
  assert.equal(result.ok, false);
});

test("verifyEditorialPlan: with a before-snapshot, genuinely proves publication_status is unchanged", async () => {
  const plan = buildEditorialPlan([validInput()]);
  const { client } = createFakeSupabaseClient({ plant_catalog: [seedCatalog({ publication_status: "published" })] });
  await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: false });

  const result = await verifyEditorialPlan({
    client, plan, catalogSlugByRef,
    expectedPublicationStatusByCatalogRef: new Map([["acer_palmatum_species", "published"]]),
  });
  assert.equal(result.ok, true);
});
