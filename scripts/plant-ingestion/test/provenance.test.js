import { test } from "node:test";
import assert from "node:assert/strict";

import { mapTrefleDetailToTraits } from "../../plant-benchmark/src/providers/trefle.js";
import { mapPerenualDetailToTraits } from "../../plant-benchmark/src/providers/perenual.js";
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

// Real live JSON contained `attracts=[]` (Acer) and `soil=[]` (Bloodgood) —
// exactly the "non-informative" values that must never produce an
// observation (spec §1). false/0 must keep producing one.
const PERENUAL_MIXED_INFORMATIVENESS_FIXTURE = {
  attracts: [],
  soil: [],
  drought_tolerant: false,
  container: 0,
  type: "tree",
};

test("buildObservations: attracts=[] produces no observation", () => {
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: PERENUAL_MIXED_INFORMATIVENESS_FIXTURE, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });
  assert.ok(!observations.some((o) => o.trait === "attracts"));
});

test("buildObservations: soil=[] produces no observation", () => {
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: PERENUAL_MIXED_INFORMATIVENESS_FIXTURE, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });
  assert.ok(!observations.some((o) => o.trait === "soil"));
});

test("buildObservations: false (drought_tolerance) still produces an observation", () => {
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: PERENUAL_MIXED_INFORMATIVENESS_FIXTURE, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });
  const obs = observations.find((o) => o.trait === "drought_tolerance");
  assert.ok(obs);
  assert.equal(obs.raw_value, false);
});

test("buildObservations: 0 (container_suitable) still produces an observation", () => {
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: PERENUAL_MIXED_INFORMATIVENESS_FIXTURE, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });
  const obs = observations.find((o) => o.trait === "container_suitable");
  assert.ok(obs);
  assert.equal(obs.raw_value, 0);
});

// Field paths (spec §5): filled in deterministically for Perenual traits
// whose reused benchmark mapper never records a field_path, since the
// underlying field read IS deterministic even though the reused code
// doesn't note it. Never overrides a field_path the provider code already
// set (e.g. the dimensions[...] paths).
test("field_path: known Perenual traits get their deterministic field_path filled in", () => {
  const detail = { type: "tree", sunlight: ["full sun"], soil: ["Well-drained"], growth_rate: "Low", drought_tolerant: false, watering: "Average", indoor: false, hardiness: { min: 6, max: 6 }, flowering_season: "Spring", edible_fruit: false, edible_leaf: false };
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: detail, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });

  const byTrait = Object.fromEntries(observations.map((o) => [o.trait, o]));
  assert.equal(byTrait.plant_type.field_path, "type");
  assert.equal(byTrait.sun.field_path, "sunlight");
  assert.equal(byTrait.soil.field_path, "soil");
  assert.equal(byTrait.growth_rate.field_path, "growth_rate");
  assert.equal(byTrait.drought_tolerance.field_path, "drought");
  assert.equal(byTrait.water_need.field_path, "watering");
  assert.equal(byTrait.indoor.field_path, "indoor");
  assert.equal(byTrait.hardiness_min.field_path, "hardiness.min");
  assert.equal(byTrait.hardiness_max.field_path, "hardiness.max");
  assert.equal(byTrait.flowering_season.field_path, "flowering_season");
  assert.equal(byTrait.edible_fruit.field_path, "edible_fruit");
  assert.equal(byTrait.edible_leaf.field_path, "edible_leaf");
  // Derived trait: an explicit, auditable compound path — never a single
  // misleading field name, never silently null either.
  assert.equal(byTrait.edible.field_path, "edible_fruit+edible_leaf");
});

test("field_path: an already-set field_path (e.g. dimensions) is never overridden by the fallback table", () => {
  const detail = { dimensions: [{ type: "Height", min_value: 20, max_value: 20, unit: "feet" }] };
  const { traits } = mapPerenualDetailToTraits({ candidateId: 27, sourceUrl: "https://perenual.com/x", detailData: detail, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "perenual", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:perenual:current", result: { traits } });
  const heightMax = observations.find((o) => o.trait === "height_max_cm");
  assert.equal(heightMax.field_path, "dimensions[type=height].max_value");
});

test("field_path: Trefle's own field_path is preserved as-is, never touched by the Perenual fallback table", () => {
  const { traits } = mapTrefleDetailToTraits({ candidateId: 1, sourceUrl: "https://trefle.io/api/v1/species/1", detailData: { growth: { light: 7 } }, retrievedAt: "2026-08-23T00:00:00.000Z" });
  const observations = buildObservations({ provider: "trefle", catalogRef: "acer_palmatum_species", sourceRecordRef: "x:trefle:current", result: { traits } });
  assert.equal(observations.find((o) => o.trait === "light_0_10").field_path, "growth.light");
});
