import { test } from "node:test";
import assert from "node:assert/strict";

import { applyPlan } from "../../src/apply/applyPlan.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";

// Full-scale reproduction of the real Acer production batch: 1 taxon, 5
// taxon_names, 2 catalog entries (species + cultivar), 6 source_records (2
// catalogs x 3 providers: wcvp, perenual, trefle), 33 trait_observations
// (30 perenual + 3 trefle, matching the real provider split found in
// production), 7 trait_selections. This is the exact shape that triggered
// two real production false positives, both now fixed:
//   - the 2 Perenual source_records' `metadata` object round-tripped with
//     a different key order than the plan (upsertSourceRecords.js)
//   - the "edible" trait observation's raw_value object round-tripped
//     with a different key order (upsertObservations.js)
// A correct re-apply of the SAME data must report everything unchanged —
// key order alone must never manufacture a fake update/create.

const SPECIES = "acer_palmatum_species";
const CULTIVAR = "acer_palmatum_bloodgood";
const TAXON = "acer_palmatum";
const PROVIDERS = ["wcvp", "perenual", "trefle"];

function buildTaxa() {
  return [
    {
      taxon_ref: TAXON,
      rank: "species",
      genus: "Acer",
      species: "palmatum",
      infraspecific_epithet: null,
      canonical_name: "Acer palmatum",
      scientific_name_full: "Acer palmatum Thunb.",
      family: "Sapindaceae",
      taxonomic_status: "accepted",
      wcvp_taxon_id: "wcvp-320245",
    },
  ];
}

function buildTaxonNames() {
  const names = ["acer palmatum", "acer palmatum thunb", "acer polymorphum", "acer palmatum var. palmatum", "acer palmatum 'bloodgood'"];
  return names.map((normalized_name, i) => ({
    taxon_ref: TAXON,
    name: normalized_name,
    normalized_name,
    name_type: i === 0 ? "accepted" : "synonym",
    source_taxon_id: null,
  }));
}

function buildCatalogEntries() {
  return [
    {
      catalog_ref: SPECIES,
      taxon_ref: TAXON,
      parent_catalog_ref: null,
      entry_type: "species",
      cultivar_name: null,
      display_name: "Acer palmatum",
      common_name: "Japanese maple",
      slug: "acer-palmatum",
      publication_status: "draft",
      review_status: "unreviewed",
      published_at: null,
      plant_type: "tree",
      growth_form: null,
      height_min_cm: 300,
      height_max_cm: 800,
      spread_max_cm: 600,
      sun: ["full_sun", "partial_shade"],
      hardiness_min_rank: 5,
      hardiness_max_rank: 9,
      evergreen: false,
      water_need: "moderate",
      container_suitable: true,
      edible: false,
      flowering_months: [4, 5],
    },
    {
      catalog_ref: CULTIVAR,
      taxon_ref: TAXON,
      parent_catalog_ref: SPECIES,
      entry_type: "cultivar",
      cultivar_name: "Bloodgood",
      display_name: "Acer palmatum 'Bloodgood'",
      common_name: "Japanese maple 'Bloodgood'",
      slug: "acer-palmatum-bloodgood",
      publication_status: "draft",
      review_status: "unreviewed",
      published_at: null,
      plant_type: "tree",
      growth_form: null,
      height_min_cm: 350,
      height_max_cm: 450,
      spread_max_cm: 450,
      sun: ["full_sun"],
      hardiness_min_rank: 5,
      hardiness_max_rank: 8,
      evergreen: false,
      water_need: "moderate",
      container_suitable: true,
      edible: false,
      flowering_months: [4],
    },
  ];
}

function buildSourceRecords() {
  const records = [];
  for (const catalogRef of [SPECIES, CULTIVAR]) {
    for (const provider of PROVIDERS) {
      records.push({
        source_record_ref: `${catalogRef}:${provider}:current`,
        catalog_ref: catalogRef,
        provider,
        provider_record_id: provider === "trefle" && catalogRef === CULTIVAR ? null : "320245",
        provider_name: catalogRef === SPECIES ? "Acer palmatum" : "Acer palmatum Bloodgood",
        provider_status: "matched",
        selection_reason: "best_match",
        taxonomy_match_type: "exact",
        candidate_count: 1,
        retrieved_at: "2026-08-24T09:00:00.000Z",
        source_url: `https://${provider}.example.com/${catalogRef}`,
        // The real production false positive: this exact metadata shape,
        // reproduced verbatim, is scrambled to a different key order for
        // the 2 perenual rows further below (after the seed apply).
        metadata: provider === "perenual" ? { cultivar_field: null, variety_field: null, subspecies_field: null, hybrid_field: null } : { lookup_strategy: "exact" },
      });
    }
  }
  return records;
}

// 30 perenual + 3 trefle observations across the 2 catalog entries,
// matching the real production provider split. One designated observation
// (species/perenual, trait "edible") carries an object raw_value — the
// real production false positive.
function buildTraitObservations() {
  const observations = [];

  function pushScalarObservations(catalogRef, provider, count) {
    for (let i = 0; i < count; i++) {
      const trait = `trait_${provider}_${i}`;
      observations.push({
        observation_ref: `${catalogRef}:${provider}:${trait}`,
        catalog_ref: catalogRef,
        source_record_ref: `${catalogRef}:${provider}:current`,
        trait,
        provider,
        field_path: null,
        raw_value: i,
        raw_unit: null,
        normalized_value: i,
        normalized_unit: null,
        source_url: `https://${provider}.example.com`,
        attribution: provider,
        license: "CC-BY-SA-4.0",
        source_retrieved_at: "2026-08-24T09:00:00.000Z",
        uncertain: false,
        source_scope: "trait",
        review_status: "unreviewed",
      });
    }
  }

  // species: 16 perenual (1 replaced below by "edible") + 2 trefle = 18
  pushScalarObservations(SPECIES, "perenual", 16);
  pushScalarObservations(SPECIES, "trefle", 2);
  // bloodgood: 14 perenual + 1 trefle = 15
  pushScalarObservations(CULTIVAR, "perenual", 14);
  pushScalarObservations(CULTIVAR, "trefle", 1);

  // 18 + 15 = 33 total; 16 + 14 = 30 perenual; 2 + 1 = 3 trefle. Matches
  // the real production counts exactly.
  assert.equal(observations.length, 33);
  assert.equal(observations.filter((o) => o.provider === "perenual").length, 30);
  assert.equal(observations.filter((o) => o.provider === "trefle").length, 3);

  // Replace the first species/perenual scalar observation with the real
  // "edible" case: an object raw_value.
  const edibleIndex = observations.findIndex((o) => o.catalog_ref === SPECIES && o.provider === "perenual" && o.trait === "trait_perenual_0");
  observations[edibleIndex] = {
    ...observations[edibleIndex],
    trait: "edible",
    observation_ref: `${SPECIES}:perenual:edible`,
    raw_value: { edible_leaf: false, edible_fruit: false },
    normalized_value: { edible_leaf: false, edible_fruit: false },
  };

  return observations;
}

function buildTraitSelections() {
  return [
    { catalog_ref: SPECIES, trait: "trait_perenual_1", selected_observation_ref: `${SPECIES}:perenual:trait_perenual_1`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: SPECIES, trait: "trait_perenual_2", selected_observation_ref: `${SPECIES}:perenual:trait_perenual_2`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: SPECIES, trait: "trait_perenual_3", selected_observation_ref: `${SPECIES}:perenual:trait_perenual_3`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: SPECIES, trait: "edible", selected_observation_ref: `${SPECIES}:perenual:edible`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: CULTIVAR, trait: "trait_perenual_1", selected_observation_ref: `${CULTIVAR}:perenual:trait_perenual_1`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: CULTIVAR, trait: "trait_perenual_2", selected_observation_ref: `${CULTIVAR}:perenual:trait_perenual_2`, decision_method: "provider_observation", decided_by: null, note: null },
    { catalog_ref: CULTIVAR, trait: "trait_perenual_3", selected_observation_ref: `${CULTIVAR}:perenual:trait_perenual_3`, decision_method: "provider_observation", decided_by: null, note: null },
  ];
}

function buildAcerPlan() {
  const taxa = buildTaxa();
  const taxon_names = buildTaxonNames();
  const catalog_entries = buildCatalogEntries();
  const source_records = buildSourceRecords();
  const trait_observations = buildTraitObservations();
  const trait_selections = buildTraitSelections();

  return {
    generated_at: "2026-08-24T09:00:00.000Z",
    source_bundle_generated_at: "2026-08-24T09:00:00.000Z",
    mode: "transaction_plan",
    approval_required: true,
    summary: {
      taxa: taxa.length,
      taxon_names: taxon_names.length,
      catalog_entries: catalog_entries.length,
      source_records: source_records.length,
      trait_observations: trait_observations.length,
      trait_selections: trait_selections.length,
    },
    taxa,
    taxon_names,
    catalog_entries,
    source_records,
    trait_observations,
    trait_selections,
    warnings: [],
  };
}

test("ACER REGRESSION: full-scale re-apply with scrambled-but-identical JSON key order reports everything unchanged (54 total)", async () => {
  const plan = buildAcerPlan();

  // 1. Seed the fake DB exactly like production already has this batch
  // fully ingested — a real apply of this exact plan.
  const seeded = createFakeSupabaseClient();
  const seedReport = await applyPlan({ client: seeded.client, plan, dryRun: false });
  assert.equal(seedReport.ok, true);
  assert.equal(seedReport.totals.created, 1 + 5 + 2 + 6 + 33 + 7); // sanity: the plan itself is exactly this shape
  assert.equal(seeded.tables.plant_trait_observations.length, 33);
  assert.equal(seeded.tables.plant_trait_selections.length, 7);

  // 2. Reproduce the real production false positives: scramble the key
  // order of the 2 Perenual source_records' metadata, and of the "edible"
  // observation's raw_value — semantically identical, syntactically
  // reordered, exactly as Postgres jsonb round-tripped them for real.
  for (const row of seeded.tables.plant_source_records) {
    if (row.provider === "perenual") {
      row.metadata = { hybrid_field: null, variety_field: null, cultivar_field: null, subspecies_field: null };
    }
  }
  const edibleRow = seeded.tables.plant_trait_observations.find((o) => o.trait === "edible");
  assert.ok(edibleRow);
  edibleRow.raw_value = { edible_fruit: false, edible_leaf: false };

  // 3. The real dry-run against this now-key-order-scrambled DB.
  const report = await applyPlan({ client: seeded.client, plan, dryRun: true });

  assert.equal(report.steps.taxa.unchanged, 1);
  assert.equal(report.steps.taxa.created, 0);
  assert.equal(report.steps.taxa.updated, 0);

  assert.equal(report.steps.taxon_names.unchanged, 5);
  assert.equal(report.steps.taxon_names.created, 0);

  assert.equal(report.steps.catalog_entries.unchanged, 2);
  assert.equal(report.steps.catalog_entries.created, 0);
  assert.equal(report.steps.catalog_entries.updated, 0);

  assert.equal(report.steps.source_records.unchanged, 6);
  assert.equal(report.steps.source_records.created, 0);
  assert.equal(report.steps.source_records.updated, 0);

  assert.equal(report.steps.trait_observations.unchanged, 33);
  assert.equal(report.steps.trait_observations.created, 0);
  assert.equal(report.steps.trait_observations.updated, 0);
  assert.equal(report.steps.trait_observations.failed ?? 0, 0);

  assert.equal(report.steps.trait_selections.unchanged, 7);
  assert.equal(report.steps.trait_selections.created, 0);
  assert.equal(report.steps.trait_selections.updated, 0);

  assert.equal(report.totals.created, 0);
  assert.equal(report.totals.updated, 0);
  assert.equal(report.totals.unchanged, 1 + 5 + 2 + 6 + 33 + 7);
  assert.equal(report.totals.unchanged, 54);
  assert.equal(report.totals.errors, 0);
  assert.equal(report.totals.skipped, 0);
  assert.equal(report.ok, true);

  // 4. Zero mutation: dry-run wrote nothing, the scrambled-but-equal rows
  // are exactly as left in step 2.
  assert.equal(seeded.tables.plant_source_records.length, 6);
  assert.equal(seeded.tables.plant_trait_observations.length, 33);
  assert.equal(seeded.tables.plant_trait_selections.length, 7);
});
