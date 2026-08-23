import { test } from "node:test";
import assert from "node:assert/strict";

import { mapTrefleDetailToTraits } from "../../plant-benchmark/src/providers/trefle.js";
import { buildObservations, buildSourceRecord } from "../src/provenance.js";

// Fixture matching the facts already validated live for Acer palmatum on
// Trefle: light_0_10=7, soil_ph_min=6.5, soil_ph_max=7 — and explicitly NO
// usable height data (growth.maximum_height.cm / minimum_height.cm both
// null, specifications.maximum_height likewise null).
const TREFLE_ACER_DETAIL_FIXTURE = {
  growth: {
    light: 7,
    ph_minimum: 6.5,
    ph_maximum: 7,
    maximum_height: { cm: null },
    minimum_height: { cm: null },
  },
  specifications: {
    maximum_height: { cm: null },
  },
};

// Test #12: Trefle never invents a height for Acer palmatum (specifically:
// never fabricates the previously-wrong 300cm figure) — a null `.cm` stays
// null, it is never turned into a guessed number, and consequently no
// height_min_cm/height_max_cm observation is produced at all.
test("#12: Trefle Acer palmatum fixture (no real height data) produces no height observation", () => {
  const { traits } = mapTrefleDetailToTraits({ candidateId: 1, sourceUrl: "https://trefle.io/api/v1/species/1", detailData: TREFLE_ACER_DETAIL_FIXTURE, retrievedAt: "2026-08-23T00:00:00.000Z" });

  assert.equal(traits.height_min_cm, undefined);
  assert.equal(traits.height_max_cm, undefined);
  assert.notEqual(traits.light_0_10, undefined);
  assert.equal(traits.light_0_10.observations[0].raw_value, 7);
  assert.equal(traits.soil_ph_min.observations[0].raw_value, 6.5);
  assert.equal(traits.soil_ph_max.observations[0].raw_value, 7);

  const observations = buildObservations({ provider: "trefle", catalogRef: "acer_palmatum_species", sourceRecordRef: "acer_palmatum_species:trefle:current", result: { traits } });
  assert.ok(!observations.some((o) => o.trait === "height_min_cm" || o.trait === "height_max_cm"));
  // Explicitly never the previously-wrong fabricated value.
  assert.ok(!observations.some((o) => o.normalized_value === 300));
});

// Test #13: Trefle "not_found" for the Bloodgood cultivar must never become
// a fictitious empty/placeholder trait observation.
test("#13: Trefle not_found for a cultivar produces zero observations, not a fictitious empty one", () => {
  const trefleNotFoundResult = { status: "not_found", selection_reason: "not_found", record: null, traits: {} };
  const observations = buildObservations({ provider: "trefle", catalogRef: "acer_palmatum_bloodgood", sourceRecordRef: "acer_palmatum_bloodgood:trefle:current", result: trefleNotFoundResult });
  assert.deepEqual(observations, []);
});

test("buildSourceRecord: unresolved_under_plan is never reported as not_found", () => {
  const { source_record } = buildSourceRecord({
    provider: "perenual",
    catalogRef: "acer_palmatum_species",
    result: { status: "unresolved_under_plan", selection_reason: "unresolved_under_plan", record: null, candidate_count: 0 },
    retrievedAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(source_record.provider_status, "unresolved_under_plan");
  assert.notEqual(source_record.provider_status, "not_found");
});

test("buildSourceRecord: never stores a raw payload field", () => {
  const { source_record } = buildSourceRecord({
    provider: "perenual",
    catalogRef: "acer_palmatum_species",
    result: { status: "ok", selection_reason: "exact_scientific_match", record: { id: 123, provider_name: "Japanese maple", scientific_name: "Acer palmatum", source_url: "https://perenual.com/api/v2/species/details/123" }, candidate_count: 1 },
    retrievedAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal("raw_payload" in source_record, false);
  assert.equal("raw" in source_record, false);
});

test("buildObservations: no traits produces an empty array, never a placeholder", () => {
  assert.deepEqual(buildObservations({ provider: "perenual", catalogRef: "x", sourceRecordRef: "x:perenual:current", result: { traits: {} } }), []);
  assert.deepEqual(buildObservations({ provider: "perenual", catalogRef: "x", sourceRecordRef: "x:perenual:current", result: {} }), []);
});
