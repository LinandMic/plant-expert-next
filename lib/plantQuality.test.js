import { test } from "node:test";
import assert from "node:assert/strict";

import { computePlantCompleteness, isPresent, CRITICAL_BLOCKS, IMPORTANT_BLOCKS } from "./plantQuality.js";

// Structural test fixtures — string/number placeholders below are never a
// claim about any real plant's actual horticultural values, only about
// presence/absence and the resulting status. "placeholder_*" values are
// used precisely to make this unambiguous.

test("no critical block present -> draft", () => {
  const result = computePlantCompleteness({});
  assert.equal(result.quality_status, "draft");
  assert.equal(result.critical.completed, 0);
});

test("only plant_type present -> ready_searchable", () => {
  const result = computePlantCompleteness({ plant_type: "placeholder_type" });
  assert.equal(result.quality_status, "ready_searchable");
});

test("only sun present -> ready_searchable", () => {
  const result = computePlantCompleteness({ sun: ["full_sun"] });
  assert.equal(result.quality_status, "ready_searchable");
});

test("only height_min_cm present -> ready_searchable", () => {
  const result = computePlantCompleteness({ height_min_cm: 50 });
  assert.equal(result.quality_status, "ready_searchable");
});

test("only height_max_cm present -> ready_searchable", () => {
  const result = computePlantCompleteness({ height_max_cm: 150 });
  assert.equal(result.quality_status, "ready_searchable");
});

test("only spread_max_cm present -> ready_searchable", () => {
  const result = computePlantCompleteness({ spread_max_cm: 100 });
  assert.equal(result.quality_status, "ready_searchable");
});

test("all 4 critical blocks present, no important -> ready_searchable (not complete)", () => {
  const result = computePlantCompleteness({
    plant_type: "placeholder_type",
    sun: ["full_sun"],
    height_min_cm: 50,
    height_max_cm: 150,
    spread_max_cm: 100,
  });
  assert.equal(result.quality_status, "ready_searchable");
  assert.equal(result.critical.completed, 4);
  assert.equal(result.critical.missing.length, 0);
  assert.equal(result.important.completed, 0);
});

test("4 critical + evergreen + water_need + flowering_months -> ready_complete", () => {
  const result = computePlantCompleteness({
    plant_type: "placeholder_type",
    sun: ["full_sun"],
    height_min_cm: 50,
    height_max_cm: 150,
    spread_max_cm: 100,
    evergreen: true,
    water_need: "placeholder_need",
    flowering_months: [4, 5],
  });
  assert.equal(result.quality_status, "ready_complete");
  assert.equal(result.critical.completed, 4);
  assert.equal(result.important.completed, 3);
  assert.equal(result.completeness_percent, 100);
});

test("false evergreen counts as present, not absent", () => {
  assert.equal(isPresent(false), true);
  const result = computePlantCompleteness({
    plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, spread_max_cm: 100,
    evergreen: false, water_need: "placeholder_need", flowering_months: [4, 5],
  });
  assert.equal(result.quality_status, "ready_complete");
  assert.ok(!result.important.missing.includes("evergreen"));
});

test("edible is never part of the score, present or absent, true or false", () => {
  const withoutEdible = computePlantCompleteness({
    plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, spread_max_cm: 100,
    evergreen: true, water_need: "placeholder_need", flowering_months: [4, 5],
  });
  const withEdibleFalse = computePlantCompleteness({
    plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, spread_max_cm: 100,
    evergreen: true, water_need: "placeholder_need", flowering_months: [4, 5], edible: false,
  });
  const withEdibleTrue = computePlantCompleteness({
    plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, spread_max_cm: 100,
    evergreen: true, water_need: "placeholder_need", flowering_months: [4, 5], edible: true,
  });
  assert.deepEqual(withoutEdible, withEdibleFalse);
  assert.deepEqual(withoutEdible, withEdibleTrue);
  assert.ok(!CRITICAL_BLOCKS.includes("edible") && !IMPORTANT_BLOCKS.includes("edible"));
});

test("[] sun is absent", () => {
  assert.equal(isPresent([]), false);
  const result = computePlantCompleteness({ sun: [] });
  assert.equal(result.quality_status, "draft");
});

test("[] flowering_months is absent", () => {
  const result = computePlantCompleteness({
    plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, spread_max_cm: 100,
    evergreen: true, water_need: "placeholder_need", flowering_months: [],
  });
  assert.ok(result.important.missing.includes("flowering_months"));
  assert.notEqual(result.quality_status, "ready_complete");
});

test("null is absent, for every field type", () => {
  assert.equal(isPresent(null), false);
  assert.equal(isPresent(undefined), false);
  assert.equal(isPresent(""), false);
  assert.equal(isPresent({}), false);
  const result = computePlantCompleteness({ plant_type: null, sun: null, height_min_cm: null, height_max_cm: null, spread_max_cm: null });
  assert.equal(result.quality_status, "draft");
});

test("0 as a numeric value is present, not absent", () => {
  assert.equal(isPresent(0), true);
  const result = computePlantCompleteness({ height_min_cm: 0 });
  assert.equal(result.quality_status, "ready_searchable");
  assert.ok(!result.critical.missing.includes("height"));
});

test("height_min_cm and height_max_cm both present still count as exactly ONE critical block", () => {
  const bothPresent = computePlantCompleteness({ height_min_cm: 50, height_max_cm: 150 });
  const onlyMin = computePlantCompleteness({ height_min_cm: 50 });
  assert.equal(bothPresent.critical.completed, 1);
  assert.equal(bothPresent.critical.completed, onlyMin.critical.completed);
});

test("taxonomyResolved=false forces draft even when every trait is present", () => {
  const result = computePlantCompleteness(
    {
      plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, height_max_cm: 150, spread_max_cm: 100,
      evergreen: true, water_need: "placeholder_need", flowering_months: [4, 5],
    },
    { taxonomyResolved: false }
  );
  assert.equal(result.quality_status, "draft");
});

test("CRITICAL_BLOCKS is exactly the 4 blocks, IMPORTANT_BLOCKS exactly the 3", () => {
  assert.deepEqual(CRITICAL_BLOCKS, ["plant_type", "sun", "height", "spread"]);
  assert.deepEqual(IMPORTANT_BLOCKS, ["evergreen", "water_need", "flowering_months"]);
});

// ==================================================================
// PILOT CASES (spec §8) — the 6 pilot-batch plants, evaluated purely
// in-memory against their real, already-established status from this
// chantier's own history. No DB write, no new research. Every entry
// below only encodes PRESENCE/ABSENCE facts already established in
// prior rounds — never a specific horticultural value.
// ==================================================================

test("PILOT: Camellia japonica — plant_type+sun selected (real, from Perenual), nothing else confirmed -> ready_searchable", () => {
  const result = computePlantCompleteness({
    plant_type: "placeholder_type",
    sun: ["full_sun"],
    // height/spread/evergreen/water_need/flowering_months: never confirmed
    // selected for Camellia in this chantier's real quality reports.
  });
  assert.equal(result.quality_status, "ready_searchable");
  assert.equal(result.critical.completed, 2);
  assert.deepEqual(result.critical.missing.sort(), ["height", "spread"]);
});

test("PILOT: Lavandula angustifolia — all 4 CRITICAL blocks real-HOLD -> draft", () => {
  const result = computePlantCompleteness({}); // plant_type/sun/height/spread all confirmed HOLD
  assert.equal(result.quality_status, "draft");
});

test("PILOT: Hydrangea macrophylla — only growth_form selected (not a tracked block) -> draft", () => {
  // Corrected real state: 4 Trefle observations (growth_form, soil_ph_min,
  // soil_ph_max, growth_rate), 1 selection (growth_form only) — none of
  // these are CRITICAL_BLOCKS/IMPORTANT_BLOCKS fields.
  const result = computePlantCompleteness({ growth_form: "placeholder_form" });
  assert.equal(result.quality_status, "draft");
  assert.equal(result.critical.completed, 0);
});

test("PILOT: Rhododendron simsii — same HOLD profile as Lavandula (Trefle obs=0) -> draft", () => {
  const result = computePlantCompleteness({});
  assert.equal(result.quality_status, "draft");
});

test("PILOT: Malus domestica — Perenual plan_restricted, no usable CRITICAL block -> draft", () => {
  const result = computePlantCompleteness({});
  assert.equal(result.quality_status, "draft");
});

test("PILOT: Hydrangea macrophylla 'Endless Summer' — taxonomy not_found forces draft regardless of any trait", () => {
  // Even if traits were hypothetically present, an unresolved taxonomy
  // (WCVP not_found for this cultivar, established in an earlier round)
  // must force draft — the exact case spec §8 calls out explicitly.
  const result = computePlantCompleteness(
    {
      plant_type: "placeholder_type", sun: ["full_sun"], height_min_cm: 50, height_max_cm: 150, spread_max_cm: 100,
      evergreen: true, water_need: "placeholder_need", flowering_months: [4, 5],
    },
    { taxonomyResolved: false }
  );
  assert.equal(result.quality_status, "draft");
});
