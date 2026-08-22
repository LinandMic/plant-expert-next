import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTrefleDetailToTraits } from "../src/providers/trefle.js";

const RETRIEVED_AT = "2026-01-01T00:00:00.000Z";

test("trefle #7: soil_moisture <- growth.soil_humidity, never atmospheric_humidity", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { growth: { soil_humidity: 5, atmospheric_humidity: 8 } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.soil_moisture.observations[0].raw_value, 5);
  assert.equal(traits.soil_moisture.observations[0].field_path, "growth.soil_humidity");
});

test("trefle #8: atmospheric_humidity is kept as its own distinct trait, never folded into soil_moisture", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { growth: { soil_humidity: 5, atmospheric_humidity: 8 } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.atmospheric_humidity.observations[0].raw_value, 8);
  assert.equal(traits.atmospheric_humidity.observations[0].field_path, "growth.atmospheric_humidity");
  // Regression guard for the bug this revision fixes: the two values must
  // never end up merged under the same trait.
  assert.notEqual(traits.soil_moisture.observations[0].raw_value, traits.atmospheric_humidity.observations[0].raw_value);
});

test("trefle: soil_moisture absent when soil_humidity absent, even if atmospheric_humidity is present", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { growth: { atmospheric_humidity: 8 } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.soil_moisture, undefined);
});

test("trefle #9: precipitation never becomes water_need — separate mm_year traits, water_need untouched", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {
      growth: {
        minimum_precipitation: { mm: 300 },
        maximum_precipitation: { mm: 900 },
      },
    },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.minimum_precipitation_mm_year.observations[0].normalized_value, 300);
  assert.equal(traits.minimum_precipitation_mm_year.observations[0].normalized_unit, "mm");
  assert.equal(traits.maximum_precipitation_mm_year.observations[0].normalized_value, 900);
  assert.equal(traits.water_need, undefined);
});

test("trefle #10: additional documented structured fields are mapped (ph, temperature, growth_rate, drought_tolerance)", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {
      growth: {
        ph_minimum: 5.5,
        ph_maximum: 7,
        minimum_temperature: { deg_c: -5 },
        maximum_temperature: { deg_c: 35 },
        growth_rate: "moderate",
        drought_tolerance: "high",
      },
    },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.soil_ph_min.observations[0].raw_value, 5.5);
  assert.equal(traits.soil_ph_max.observations[0].raw_value, 7);
  assert.equal(traits.min_temperature_c.observations[0].normalized_value, -5);
  assert.equal(traits.max_temperature_c.observations[0].normalized_value, 35);
  assert.equal(traits.growth_rate.observations[0].raw_value, "moderate");
  assert.equal(traits.drought_tolerance.observations[0].raw_value, "high");
});

test("trefle #11: height from growth.* and specifications.* kept as separate observations, never collapsed", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {
      growth: { maximum_height: { cm: 250 } },
      specifications: { maximum_height: 300 },
    },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm.observations.length, 2);
  const paths = traits.height_max_cm.observations.map((o) => o.field_path).sort();
  assert.deepEqual(paths, ["growth.maximum_height", "specifications.maximum_height"]);
  const growthObs = traits.height_max_cm.observations.find((o) => o.field_path === "growth.maximum_height");
  assert.equal(growthObs.normalized_value, 250);
  const specObs = traits.height_max_cm.observations.find((o) => o.field_path === "specifications.maximum_height");
  assert.equal(specObs.raw_value, 300);
  // specifications.maximum_height's unit was never confirmed live — it must
  // never be silently assumed to already be centimeters.
  assert.equal(specObs.normalized_value, null);
});

test("trefle #12: provenance is record-scope only — never attributed to sources[0] per trait", () => {
  const { traits, provenance } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {
      sources: [{ name: "Some Source", url: "https://example.test/source" }],
      growth: { soil_humidity: 5 },
    },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(provenance.provider, "trefle");
  assert.equal(provenance.source_scope, "record");
  assert.deepEqual(provenance.record_sources, [{ name: "Some Source", url: "https://example.test/source" }]);
  // Regression guard for the bug this revision fixes: no individual
  // observation carries a license/attribution inferred from sources[0].
  assert.equal(traits.soil_moisture.observations[0].license, null);
  assert.equal(traits.soil_moisture.observations[0].attribution, null);
});
