import { test } from "node:test";
import assert from "node:assert/strict";

import { compileObservations } from "../../src/plan/compileObservations.js";

const SOURCE_RECORDS = [
  { source_record_ref: "acer_palmatum_species:perenual:current", catalog_ref: "acer_palmatum_species", provider: "perenual" },
  { source_record_ref: "acer_palmatum_species:trefle:current", catalog_ref: "acer_palmatum_species", provider: "trefle" },
];

function obs(overrides = {}) {
  return {
    observation_ref: "acer_palmatum_species:perenual:height_max_cm",
    catalog_ref: "acer_palmatum_species",
    trait: "height_max_cm",
    provider: "perenual",
    field_path: "dimensions[type=height].max_value",
    raw_value: 20,
    raw_unit: "feet",
    normalized_value: 609.6,
    normalized_unit: "cm",
    source_record_ref: "acer_palmatum_species:perenual:current",
    source_url: null,
    attribution: null,
    license: null,
    source_retrieved_at: "2026-08-24T00:00:00.000Z",
    uncertain: false,
    source_scope: "record",
    review_status: "unreviewed",
    ...overrides,
  };
}

test("compiles observations that correctly resolve to their own catalog_ref+provider source record", () => {
  const { observations, errors } = compileObservations([{ trait_observations: [obs()] }], SOURCE_RECORDS);
  assert.deepEqual(errors, []);
  assert.equal(observations.length, 1);
});

// Item 8: an observation whose provider doesn't match its stated
// source_record_ref (points at the WRONG provider's source record) is
// rejected.
test("8: an observation pointing at the wrong provider's source record is rejected", () => {
  const badObs = obs({ source_record_ref: "acer_palmatum_species:trefle:current" }); // provider=perenual but ref says trefle
  const { errors } = compileObservations([{ trait_observations: [badObs] }], SOURCE_RECORDS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "OBSERVATION_SOURCE_RECORD_MISMATCH");
});

test("duplicate observation_ref is rejected", () => {
  const { errors } = compileObservations([{ trait_observations: [obs(), obs()] }], SOURCE_RECORDS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "DUPLICATE_OBSERVATION_REF");
});
