// Shared minimal-but-realistic transaction plan fixture for Layer C tests.
// Shapes mirror the real compiler output (scripts/plant-ingestion/src/plan/
// compile*.js) and the real DB columns (supabase/migrations/
// 20260823124800_create_plant_finder_catalog_v1.sql) — one species-level
// catalog entry, one external observation + one editorial observation, one
// selection, deliberately small so each test can reason about exact counts.

export function buildTaxon(overrides = {}) {
  return {
    taxon_ref: "acer_palmatum",
    rank: "species",
    genus: "Acer",
    species: "palmatum",
    infraspecific_epithet: null,
    canonical_name: "Acer palmatum",
    scientific_name_full: "Acer palmatum Thunb.",
    family: "Sapindaceae",
    taxonomic_status: "accepted",
    wcvp_taxon_id: "wcvp-320245",
    ...overrides,
  };
}

export function buildTaxonName(overrides = {}) {
  return {
    taxon_ref: "acer_palmatum",
    name: "Acer palmatum",
    normalized_name: "acer palmatum",
    name_type: "accepted",
    source_taxon_id: null,
    ...overrides,
  };
}

export function buildCatalogEntry(overrides = {}) {
  return {
    catalog_ref: "acer_palmatum_species",
    taxon_ref: "acer_palmatum",
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
    ...overrides,
  };
}

export function buildSourceRecord(overrides = {}) {
  return {
    source_record_ref: "acer_palmatum_species:perenual:current",
    catalog_ref: "acer_palmatum_species",
    provider: "perenual",
    provider_record_id: "320245",
    provider_name: "Acer palmatum",
    provider_status: "matched",
    selection_reason: "best_match",
    taxonomy_match_type: "exact",
    candidate_count: 1,
    retrieved_at: "2026-01-01T00:00:00.000Z",
    source_url: "https://perenual.com/species/320245",
    metadata: { candidates: 1 },
    ...overrides,
  };
}

export function buildProviderObservation(overrides = {}) {
  return {
    observation_ref: "acer_palmatum_species:perenual:height_max_cm",
    catalog_ref: "acer_palmatum_species",
    source_record_ref: "acer_palmatum_species:perenual:current",
    trait: "height_max_cm",
    provider: "perenual",
    field_path: "dimensions.height.max",
    raw_value: 800,
    raw_unit: "cm",
    normalized_value: 800,
    normalized_unit: "cm",
    source_url: "https://perenual.com/species/320245",
    attribution: "Perenual",
    license: "CC-BY-SA-4.0",
    source_retrieved_at: "2026-01-01T00:00:00.000Z",
    uncertain: false,
    source_scope: "trait",
    review_status: "unreviewed",
    ...overrides,
  };
}

export function buildEditorialObservation(overrides = {}) {
  return {
    observation_ref: "acer_palmatum_species:editorial:plant_type",
    catalog_ref: "acer_palmatum_species",
    source_record_ref: null,
    trait: "plant_type",
    provider: "editorial",
    field_path: null,
    raw_value: "tree",
    raw_unit: null,
    normalized_value: "tree",
    normalized_unit: null,
    source_url: null,
    attribution: null,
    license: null,
    source_retrieved_at: null,
    uncertain: false,
    source_scope: "editorial",
    review_status: "unreviewed",
    ...overrides,
  };
}

export function buildSelection(overrides = {}) {
  return {
    catalog_ref: "acer_palmatum_species",
    trait: "height_max_cm",
    selected_observation_ref: "acer_palmatum_species:perenual:height_max_cm",
    decision_method: "provider_observation",
    decided_by: null,
    note: "Initial selection from a deterministic provider observation (dry-run promotion).",
    ...overrides,
  };
}

// buildMiniPlan(overrides) -> a full, guardPlan-valid transaction plan with
// 1 taxon, 1 taxon_name, 1 catalog entry, 1 source record, 2 observations
// (1 external + 1 editorial), 1 selection.
export function buildMiniPlan(overrides = {}) {
  const taxa = overrides.taxa ?? [buildTaxon()];
  const taxon_names = overrides.taxon_names ?? [buildTaxonName()];
  const catalog_entries = overrides.catalog_entries ?? [buildCatalogEntry()];
  const source_records = overrides.source_records ?? [buildSourceRecord()];
  const trait_observations = overrides.trait_observations ?? [buildProviderObservation(), buildEditorialObservation()];
  const trait_selections = overrides.trait_selections ?? [buildSelection()];

  return {
    generated_at: "2026-01-01T00:00:00.000Z",
    source_bundle_generated_at: "2026-01-01T00:00:00.000Z",
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
