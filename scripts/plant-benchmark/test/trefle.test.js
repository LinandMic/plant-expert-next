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
  // specifications.maximum_height is `{ cm: <number|null> }`, verified live
  // — not a bare number (corrected from this benchmark's earlier
  // assumption; see the dedicated specifications.maximum_height.cm tests
  // below for the null-handling regression guard).
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {
      growth: { maximum_height: { cm: 250 } },
      specifications: { maximum_height: { cm: 300 } },
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
  assert.equal(specObs.normalized_value, 300);
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

// --- Corrections after real-API testing ---------------------------------

// Real `/species/{id}` fixture excerpt, verified live for Acer palmatum.
const REAL_TREFLE_FIXTURE = {
  specifications: { maximum_height: { cm: null }, average_height: { cm: null }, growth_rate: null },
  growth: {
    spread: { cm: null },
    minimum_temperature: { deg_f: null, deg_c: null },
    maximum_temperature: { deg_f: null, deg_c: null },
    minimum_precipitation: { mm: null },
    maximum_precipitation: { mm: null },
    soil_humidity: null,
    soil_texture: null,
    light: 7,
  },
  foliage: { leaf_retention: null },
  sources: [{ name: "s1" }, { name: "s2" }, { name: "s3" }, { name: "s4" }, { name: "s5" }],
};

test("trefle: specifications.maximum_height.cm is read explicitly, not the object itself as a raw value", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { specifications: { maximum_height: { cm: 609.6 } } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm.observations[0].raw_value, 609.6);
  assert.equal(traits.height_max_cm.observations[0].normalized_value, 609.6);
  assert.equal(traits.height_max_cm.observations[0].field_path, "specifications.maximum_height");
});

test("trefle: specifications.maximum_height = {cm: null} -> never turned into 0, no fabricated observation", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { specifications: { maximum_height: { cm: null } } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm, undefined);
});

test("trefle: specifications.average_height.cm maps to its own height_avg_cm trait (neither min nor max)", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { specifications: { average_height: { cm: 450 } } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_avg_cm.observations[0].normalized_value, 450);
  assert.equal(traits.height_min_cm, undefined);
  assert.equal(traits.height_max_cm, undefined);
});

test("trefle: growth_rate reads specifications.growth_rate (real path), not growth.growth_rate", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { specifications: { growth_rate: "Moderate" }, growth: { growth_rate: "Low" } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.growth_rate.observations[0].raw_value, "Moderate");
  assert.equal(traits.growth_rate.observations[0].field_path, "specifications.growth_rate");
  assert.equal(traits.growth_rate.observations.length, 1);
});

test("trefle: growth.growth_rate is only a fallback used when specifications.growth_rate is absent, never overwriting it", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { growth: { growth_rate: "Low" } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.growth_rate.observations[0].raw_value, "Low");
  assert.equal(traits.growth_rate.observations[0].field_path, "growth.growth_rate");
});

test("trefle: growth.light=7 is kept as light_0_10 verbatim, never converted to a sun-exposure category", () => {
  const { traits } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { growth: { light: 7 } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.light_0_10.observations[0].raw_value, 7);
  assert.equal(traits.light_0_10.observations[0].normalized_value, 7);
  // Regression guard for the bug this revision fixes: light must never
  // populate the canonical `sun` trait.
  assert.equal(traits.sun, undefined);
});

test("trefle: real fixture (Acer palmatum species/{id} shape) — all nested nulls stay null, nothing fabricated", () => {
  const { traits, provenance } = mapTrefleDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: REAL_TREFLE_FIXTURE,
    retrievedAt: RETRIEVED_AT,
  });

  // Every nested {x: null} field produces no fabricated observation.
  assert.equal(traits.height_max_cm, undefined);
  assert.equal(traits.height_avg_cm, undefined);
  assert.equal(traits.spread_max_cm, undefined);
  assert.equal(traits.min_temperature_c, undefined);
  assert.equal(traits.max_temperature_c, undefined);
  assert.equal(traits.minimum_precipitation_mm_year, undefined);
  assert.equal(traits.maximum_precipitation_mm_year, undefined);
  assert.equal(traits.soil_moisture, undefined);
  assert.equal(traits.soil_texture, undefined);
  assert.equal(traits.growth_rate, undefined);
  assert.equal(traits.evergreen, undefined);

  // The one genuinely present value (light=7) is kept verbatim.
  assert.equal(traits.light_0_10.observations[0].raw_value, 7);

  // sources count: 5 — kept at record scope, never split per trait.
  assert.equal(provenance.record_sources.length, 5);
  assert.equal(provenance.source_scope, "record");
});
