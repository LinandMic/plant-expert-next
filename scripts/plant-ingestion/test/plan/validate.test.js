import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBundleForCompilation } from "../../src/plan/validate.js";

const TAXONOMY = { taxon_ref: "acer_palmatum", canonical_name: "Acer palmatum", taxonomic_status: "accepted", wcvp_taxon_id: "207798951", names: [] };

function catalog(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", entry_type: "species", parent_catalog_ref: null, publication_status: "draft", review_status: "unreviewed", ...overrides };
}

function obs(overrides = {}) {
  return { observation_ref: "acer_palmatum_species:perenual:height_max_cm", catalog_ref: "acer_palmatum_species", provider: "perenual", trait: "height_max_cm", raw_value: 20, normalized_value: 609.6, ...overrides };
}

function sr(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", provider: "perenual", ...overrides };
}

function selection(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", trait: "height_max_cm", observation_ref: "acer_palmatum_species:perenual:height_max_cm", normalized_value: 609.6, status: "proposed", ...overrides };
}

function plant(overrides = {}) {
  return { input: { name: "Acer palmatum" }, blocked: false, taxonomy: TAXONOMY, catalog: catalog(), source_records: [sr()], trait_observations: [obs()], trait_selections: [selection()], ...overrides };
}

function validBundle(plantOverrides = {}) {
  return { mode: "dry_run", plants: [plant(plantOverrides)] };
}

test("a fully valid plant produces no errors", () => {
  assert.deepEqual(validateBundleForCompilation(validBundle()), []);
});

test("mode !== dry_run is rejected", () => {
  const errors = validateBundleForCompilation({ mode: "live", plants: [plant()] });
  assert.equal(errors[0].code, "INVALID_MODE");
});

test("empty plants is rejected", () => {
  const errors = validateBundleForCompilation({ mode: "dry_run", plants: [] });
  assert.equal(errors[0].code, "EMPTY_PLANTS");
});

test("blocked plant is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ blocked: true }));
  assert.ok(errors.some((e) => e.code === "PLANT_BLOCKED"));
});

test("unresolved taxonomy (null) is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ taxonomy: null }));
  assert.ok(errors.some((e) => e.code === "TAXONOMY_UNRESOLVED"));
});

test("taxonomic_status !== accepted is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ taxonomy: { ...TAXONOMY, taxonomic_status: "synonym" } }));
  assert.ok(errors.some((e) => e.code === "TAXONOMY_NOT_ACCEPTED"));
});

test("publication_status !== draft is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ catalog: catalog({ publication_status: "published" }) }));
  assert.ok(errors.some((e) => e.code === "PUBLICATION_NOT_DRAFT"));
});

test("review_status !== unreviewed is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ catalog: catalog({ review_status: "reviewed" }) }));
  assert.ok(errors.some((e) => e.code === "REVIEW_NOT_UNREVIEWED"));
});

test("cultivar without parent_catalog_ref is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ catalog: catalog({ entry_type: "cultivar", parent_catalog_ref: null }) }));
  assert.ok(errors.some((e) => e.code === "CULTIVAR_NO_PARENT"));
});

test("non-informative raw_value observation is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ trait_observations: [obs({ raw_value: [] })] }));
  assert.ok(errors.some((e) => e.code === "NON_INFORMATIVE_RAW_VALUE"));
});

test("external observation without a matching source_record is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ source_records: [] }));
  assert.ok(errors.some((e) => e.code === "OBSERVATION_MISSING_SOURCE_RECORD"));
});

// Item 9: selection pointing at an absent observation -> rejected.
test("9: selection pointing at an absent observation is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ trait_selections: [selection({ observation_ref: "does-not-exist" })] }));
  assert.ok(errors.some((e) => e.code === "SELECTION_DANGLING_REF"));
});

// Item 11: selection.normalized_value != observation.normalized_value -> rejected.
test("11: selection.normalized_value differing from its observation's normalized_value is rejected", () => {
  const errors = validateBundleForCompilation(validBundle({ trait_selections: [selection({ normalized_value: 999 })] }));
  assert.ok(errors.some((e) => e.code === "SELECTION_VALUE_MISMATCH"));
});

// Item 12: selection with normalized_value=null -> rejected.
test("12: selection with a null normalized_value is rejected", () => {
  const errors = validateBundleForCompilation(
    validBundle({
      trait_observations: [obs({ normalized_value: null })],
      trait_selections: [selection({ normalized_value: null })],
    })
  );
  assert.ok(errors.some((e) => e.code === "SELECTION_NON_INFORMATIVE"));
});

test("selection trait not a supported plant_catalog column is rejected", () => {
  const errors = validateBundleForCompilation(
    validBundle({
      trait_observations: [obs({ observation_ref: "x:perenual:soil_ph_min", trait: "soil_ph_min", normalized_value: 6.5 })],
      trait_selections: [selection({ trait: "soil_ph_min", observation_ref: "x:perenual:soil_ph_min", normalized_value: 6.5 })],
    })
  );
  assert.ok(errors.some((e) => e.code === "SELECTION_UNSUPPORTED_TRAIT"));
});
