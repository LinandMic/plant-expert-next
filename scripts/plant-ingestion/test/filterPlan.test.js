import { test } from "node:test";
import assert from "node:assert/strict";

import { filterPlanByCatalogRefs } from "../src/filterPlan.js";
import { guardPlan } from "../src/apply/planGuard.js";

// A synthetic 3-taxon-family, 4-catalog-entry multi-plant plan, shaped
// like a real pilot batch: Camellia japonica (standalone species, exactly
// the real counts found for it: 3 source_records, 12 observations, 2
// selections), Hydrangea macrophylla (species + 'Endless Summer' cultivar,
// sharing one taxon), and Lavandula angustifolia (standalone species) —
// enough to exercise single-ref, multi-ref, and shared-taxon filtering.

function makeSourceRecords(catalogRef, providers) {
  return providers.map((provider) => ({
    source_record_ref: `${catalogRef}:${provider}:current`,
    catalog_ref: catalogRef,
    provider,
    provider_record_id: "1",
    provider_name: catalogRef,
    provider_status: "matched",
    selection_reason: "best_match",
    taxonomy_match_type: "exact",
    candidate_count: 1,
    retrieved_at: "2026-08-24T09:00:00.000Z",
    source_url: `https://${provider}.example.com/${catalogRef}`,
    metadata: null,
  }));
}

function makeObservations(catalogRef, provider, count) {
  const observations = [];
  for (let i = 0; i < count; i += 1) {
    const trait = `trait_${i}`;
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
  return observations;
}

function makeSelections(catalogRef, provider, count) {
  const selections = [];
  for (let i = 0; i < count; i += 1) {
    selections.push({
      catalog_ref: catalogRef,
      trait: `trait_${i}`,
      selected_observation_ref: `${catalogRef}:${provider}:trait_${i}`,
      decision_method: "provider_observation",
      decided_by: null,
      note: null,
    });
  }
  return selections;
}

function buildMultiPlantPlan() {
  const taxa = [
    { taxon_ref: "camellia_japonica", rank: "species", genus: "Camellia", species: "japonica", infraspecific_epithet: null, canonical_name: "Camellia japonica", scientific_name_full: "Camellia japonica L.", family: "Theaceae", taxonomic_status: "accepted", wcvp_taxon_id: "wcvp-1" },
    { taxon_ref: "hydrangea_macrophylla", rank: "species", genus: "Hydrangea", species: "macrophylla", infraspecific_epithet: null, canonical_name: "Hydrangea macrophylla", scientific_name_full: "Hydrangea macrophylla (Thunb.) Ser.", family: "Hydrangeaceae", taxonomic_status: "accepted", wcvp_taxon_id: "wcvp-2" },
    { taxon_ref: "lavandula_angustifolia", rank: "species", genus: "Lavandula", species: "angustifolia", infraspecific_epithet: null, canonical_name: "Lavandula angustifolia", scientific_name_full: "Lavandula angustifolia Mill.", family: "Lamiaceae", taxonomic_status: "accepted", wcvp_taxon_id: "wcvp-3" },
  ];

  const taxon_names = [
    { taxon_ref: "camellia_japonica", name: "Camellia japonica", normalized_name: "camellia japonica", name_type: "accepted", source_taxon_id: null },
    { taxon_ref: "hydrangea_macrophylla", name: "Hydrangea macrophylla", normalized_name: "hydrangea macrophylla", name_type: "accepted", source_taxon_id: null },
    { taxon_ref: "lavandula_angustifolia", name: "Lavandula angustifolia", normalized_name: "lavandula angustifolia", name_type: "accepted", source_taxon_id: null },
  ];

  const catalog_entries = [
    { catalog_ref: "camellia_japonica_species", taxon_ref: "camellia_japonica", parent_catalog_ref: null, entry_type: "species", cultivar_name: null, display_name: "Camellia japonica", common_name: "Japanese camellia", slug: "camellia-japonica", publication_status: "draft", review_status: "unreviewed", published_at: null, plant_type: "shrub", growth_form: null, height_min_cm: 150, height_max_cm: 450, spread_max_cm: 300, sun: ["partial_shade"], hardiness_min_rank: 7, hardiness_max_rank: 9, evergreen: true, water_need: "moderate", container_suitable: true, edible: false, flowering_months: [1, 2, 3] },
    { catalog_ref: "hydrangea_macrophylla_species", taxon_ref: "hydrangea_macrophylla", parent_catalog_ref: null, entry_type: "species", cultivar_name: null, display_name: "Hydrangea macrophylla", common_name: "Bigleaf hydrangea", slug: "hydrangea-macrophylla", publication_status: "draft", review_status: "unreviewed", published_at: null, plant_type: "shrub", growth_form: null, height_min_cm: 100, height_max_cm: 200, spread_max_cm: 200, sun: ["partial_shade"], hardiness_min_rank: 6, hardiness_max_rank: 9, evergreen: false, water_need: "high", container_suitable: true, edible: false, flowering_months: [6, 7, 8] },
    { catalog_ref: "hydrangea_macrophylla_endless_summer", taxon_ref: "hydrangea_macrophylla", parent_catalog_ref: "hydrangea_macrophylla_species", entry_type: "cultivar", cultivar_name: "Endless Summer", display_name: "Hydrangea macrophylla 'Endless Summer'", common_name: "Endless Summer hydrangea", slug: "hydrangea-macrophylla-endless-summer", publication_status: "draft", review_status: "unreviewed", published_at: null, plant_type: "shrub", growth_form: null, height_min_cm: 90, height_max_cm: 150, spread_max_cm: 150, sun: ["partial_shade"], hardiness_min_rank: 4, hardiness_max_rank: 9, evergreen: false, water_need: "high", container_suitable: true, edible: false, flowering_months: [6, 7, 8, 9] },
    { catalog_ref: "lavandula_angustifolia_species", taxon_ref: "lavandula_angustifolia", parent_catalog_ref: null, entry_type: "species", cultivar_name: null, display_name: "Lavandula angustifolia", common_name: "English lavender", slug: "lavandula-angustifolia", publication_status: "draft", review_status: "unreviewed", published_at: null, plant_type: "perennial", growth_form: null, height_min_cm: 30, height_max_cm: 60, spread_max_cm: 60, sun: ["full_sun"], hardiness_min_rank: 5, hardiness_max_rank: 9, evergreen: true, water_need: "low", container_suitable: true, edible: false, flowering_months: [6, 7] },
  ];

  const source_records = [
    ...makeSourceRecords("camellia_japonica_species", ["wcvp", "perenual", "trefle"]), // exactly 3, matches the real Camellia count
    ...makeSourceRecords("hydrangea_macrophylla_species", ["wcvp", "trefle"]),
    ...makeSourceRecords("hydrangea_macrophylla_endless_summer", ["wcvp"]),
    ...makeSourceRecords("lavandula_angustifolia_species", ["wcvp", "trefle"]),
  ];

  const trait_observations = [
    ...makeObservations("camellia_japonica_species", "perenual", 12), // exactly 12, matches the real Camellia count
    ...makeObservations("hydrangea_macrophylla_species", "trefle", 3),
    ...makeObservations("hydrangea_macrophylla_endless_summer", "wcvp", 1),
    ...makeObservations("lavandula_angustifolia_species", "trefle", 2),
  ];

  const trait_selections = [
    ...makeSelections("camellia_japonica_species", "perenual", 2), // exactly 2, matches the real Camellia count
    ...makeSelections("hydrangea_macrophylla_species", "trefle", 1),
    ...makeSelections("lavandula_angustifolia_species", "trefle", 1),
  ];

  return {
    generated_at: "2026-09-01T00:00:00.000Z",
    source_bundle_generated_at: "2026-08-31T00:00:00.000Z",
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
    warnings: ["some plant-level warning from Layer A"],
  };
}

// 1. filter 1 catalog_ref
test("1: filtering a single standalone catalog_ref keeps exactly its own rows", () => {
  const plan = buildMultiPlantPlan();
  const filtered = filterPlanByCatalogRefs(plan, ["camellia_japonica_species"]);

  assert.equal(filtered.catalog_entries.length, 1);
  assert.equal(filtered.catalog_entries[0].catalog_ref, "camellia_japonica_species");
  assert.equal(filtered.taxa.length, 1);
  assert.equal(filtered.taxa[0].taxon_ref, "camellia_japonica");
  assert.equal(filtered.taxon_names.length, 1);
  assert.equal(filtered.source_records.length, 3);
  assert.equal(filtered.trait_observations.length, 12);
  assert.equal(filtered.trait_selections.length, 2);
  assert.deepEqual(filtered.summary, {
    taxa: 1,
    taxon_names: 1,
    catalog_entries: 1,
    source_records: 3,
    trait_observations: 12,
    trait_selections: 2,
  });
});

// 2. filter multiple catalog_ref
test("2: filtering several catalog_ref values keeps the union of their rows, no cross-contamination", () => {
  const plan = buildMultiPlantPlan();
  const filtered = filterPlanByCatalogRefs(plan, ["camellia_japonica_species", "lavandula_angustifolia_species"]);

  assert.equal(filtered.catalog_entries.length, 2);
  const refs = filtered.catalog_entries.map((c) => c.catalog_ref).sort();
  assert.deepEqual(refs, ["camellia_japonica_species", "lavandula_angustifolia_species"]);
  assert.equal(filtered.taxa.length, 2);
  assert.equal(filtered.source_records.length, 3 + 2);
  assert.equal(filtered.trait_observations.length, 12 + 2);
  assert.equal(filtered.trait_selections.length, 2 + 1);
  // No Hydrangea data leaked in.
  assert.ok(!filtered.catalog_entries.some((c) => c.catalog_ref.startsWith("hydrangea")));
  assert.ok(!filtered.source_records.some((s) => s.catalog_ref.startsWith("hydrangea")));
});

// 3. taxon shared by species+cultivar
test("3: requesting only a cultivar auto-includes its parent species (dependency closure), sharing one taxon without duplication", () => {
  const plan = buildMultiPlantPlan();
  const filtered = filterPlanByCatalogRefs(plan, ["hydrangea_macrophylla_endless_summer"]);

  const refs = filtered.catalog_entries.map((c) => c.catalog_ref).sort();
  assert.deepEqual(refs, ["hydrangea_macrophylla_endless_summer", "hydrangea_macrophylla_species"]);
  // The taxon is shared — appears exactly once, not duplicated.
  assert.equal(filtered.taxa.length, 1);
  assert.equal(filtered.taxa[0].taxon_ref, "hydrangea_macrophylla");
  assert.equal(filtered.taxon_names.length, 1);
  // Both catalog entries' own source_records/observations/selections come along.
  assert.equal(filtered.source_records.length, 2 + 1);
  assert.equal(filtered.trait_observations.length, 3 + 1);
  assert.equal(filtered.trait_selections.length, 1);
});

test("3bis: requesting both species and cultivar together is identical to requesting the cultivar alone", () => {
  const plan = buildMultiPlantPlan();
  const cultivarOnly = filterPlanByCatalogRefs(plan, ["hydrangea_macrophylla_endless_summer"]);
  const both = filterPlanByCatalogRefs(plan, ["hydrangea_macrophylla_species", "hydrangea_macrophylla_endless_summer"]);
  assert.deepEqual(
    cultivarOnly.catalog_entries.map((c) => c.catalog_ref).sort(),
    both.catalog_entries.map((c) => c.catalog_ref).sort()
  );
  assert.equal(cultivarOnly.taxa.length, both.taxa.length);
});

// 4. unknown catalog_ref -> error
test("4: an unknown catalog_ref throws, never silently produces a partial result", () => {
  const plan = buildMultiPlantPlan();
  assert.throws(() => filterPlanByCatalogRefs(plan, ["not_a_real_catalog_ref"]), /unknown catalog_ref/);
  // Even mixed with a valid one — the whole request is rejected, not partially honored.
  assert.throws(() => filterPlanByCatalogRefs(plan, ["camellia_japonica_species", "not_a_real_catalog_ref"]), /unknown catalog_ref/);
});

test("rejects an empty catalogRefs array", () => {
  const plan = buildMultiPlantPlan();
  assert.throws(() => filterPlanByCatalogRefs(plan, []), /non-empty array/);
});

// 5. no orphan FK
test("5: the filtered sub-plan always passes guardPlan (no orphan FK), for every filtering scenario above", () => {
  const plan = buildMultiPlantPlan();
  for (const refs of [["camellia_japonica_species"], ["camellia_japonica_species", "lavandula_angustifolia_species"], ["hydrangea_macrophylla_endless_summer"], ["lavandula_angustifolia_species"]]) {
    const filtered = filterPlanByCatalogRefs(plan, refs);
    assert.deepEqual(guardPlan(filtered), []);
  }
});

// 6. deterministic order
test("6: filtered arrays always match the source plan's own row order, regardless of --catalog-ref argument order", () => {
  const plan = buildMultiPlantPlan();
  const a = filterPlanByCatalogRefs(plan, ["lavandula_angustifolia_species", "camellia_japonica_species"]);
  const b = filterPlanByCatalogRefs(plan, ["camellia_japonica_species", "lavandula_angustifolia_species"]);
  assert.deepEqual(a.catalog_entries.map((c) => c.catalog_ref), b.catalog_entries.map((c) => c.catalog_ref));
  // And matches the ORIGINAL plan's relative order (camellia before lavandula in the source).
  assert.deepEqual(a.catalog_entries.map((c) => c.catalog_ref), ["camellia_japonica_species", "lavandula_angustifolia_species"]);
});

// 7. source plan not modified
test("7: the source plan object is never mutated by filtering", () => {
  const plan = buildMultiPlantPlan();
  const beforeJson = JSON.stringify(plan);
  filterPlanByCatalogRefs(plan, ["camellia_japonica_species"]);
  filterPlanByCatalogRefs(plan, ["hydrangea_macrophylla_endless_summer"]);
  const afterJson = JSON.stringify(plan);
  assert.equal(beforeJson, afterJson);
});

test("the sub-plan carries approval_required=true and mode=transaction_plan, same contract as any Layer B plan", () => {
  const plan = buildMultiPlantPlan();
  const filtered = filterPlanByCatalogRefs(plan, ["camellia_japonica_species"]);
  assert.equal(filtered.mode, "transaction_plan");
  assert.equal(filtered.approval_required, true);
});
