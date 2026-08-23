import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCoverage,
  computeExtraDiscoveredTraitCoverage,
  computeRecordCoverage,
  computeExactCultivarCoverage,
  computePlanRestrictedCount,
  computeUnresolvedUnderPlanCount,
  eligibleCount,
  discoverTraitNames,
  BENCHMARK_TRAITS,
} from "../src/coverage.js";

// Small fixture panel: 3 plants, 1 cultivar entry. Mirrors the shape
// index.js actually produces (only the fields these functions read).
function plant({ inputType, provider, reason, traitValue }) {
  return {
    input_type: inputType,
    providers: {
      perenual: { selection_reason: provider === "perenual" ? reason : "skipped_no_key" },
      trefle: { selection_reason: provider === "trefle" ? reason : "skipped_no_key" },
    },
    traits: traitValue === undefined ? {} : { height_max_cm: { trait: "height_max_cm", observations: [{ provider, normalized_value: traitValue }] } },
  };
}

test("eligibleCount: counts exact/parent_taxon/parent_only, excludes ambiguous/not_found/provider_error/skipped", () => {
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match" }),
    plant({ inputType: "species", provider: "perenual", reason: "parent_taxon_match" }),
    plant({ inputType: "cultivar", provider: "perenual", reason: "parent_only" }),
    plant({ inputType: "species", provider: "perenual", reason: "ambiguous" }),
    plant({ inputType: "species", provider: "perenual", reason: "not_found" }),
    plant({ inputType: "species", provider: "perenual", reason: "provider_error" }),
  ];
  assert.equal(eligibleCount(normalized, "perenual"), 3);
});

test("computeRecordCoverage: denominator is always the full panel, not a filtered subset", () => {
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match" }),
    plant({ inputType: "species", provider: "perenual", reason: "ambiguous" }),
    plant({ inputType: "species", provider: "perenual", reason: "not_found" }),
  ];
  const cov = computeRecordCoverage(normalized, "perenual");
  assert.deepEqual(cov, { found: 1, total: 3, percent: 33.3 });
});

test("computeExactCultivarCoverage: only exact_cultivar_match counts, parent_only never counts as a cultivar found", () => {
  const normalized = [
    plant({ inputType: "cultivar", provider: "perenual", reason: "exact_cultivar_match" }),
    plant({ inputType: "cultivar", provider: "perenual", reason: "parent_only" }),
    plant({ inputType: "cultivar", provider: "perenual", reason: "exact_cultivar_match" }),
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match" }), // not a cultivar entry, excluded from denominator
  ];
  const cov = computeExactCultivarCoverage(normalized, "perenual");
  assert.deepEqual(cov, { found: 2, total: 3, percent: 66.7 });
});

test("computeExactCultivarCoverage: zero cultivar entries in panel -> total 0, percent 0, never NaN/division by zero", () => {
  const normalized = [plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match" })];
  const cov = computeExactCultivarCoverage(normalized, "perenual");
  assert.deepEqual(cov, { found: 0, total: 0, percent: 0 });
});

test("computeCoverage: conditional vs end-to-end are distinct denominators, never conflated", () => {
  // 3 eligible perenual records out of 5 total plants; trait present on 2 of the 3 eligible ones.
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match", traitValue: 100 }),
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match", traitValue: 200 }),
    plant({ inputType: "species", provider: "perenual", reason: "parent_taxon_match" }), // eligible, but no trait value
    plant({ inputType: "species", provider: "perenual", reason: "not_found" }),
    plant({ inputType: "species", provider: "perenual", reason: "ambiguous" }),
  ];
  const rows = computeCoverage(normalized);
  const row = rows.find((r) => r.trait === "height_max_cm");
  assert.equal(row.perenual_found, 2);
  assert.equal(row.perenual_conditional_total, 3);
  assert.equal(row.perenual_conditional_percent, 66.7);
  assert.equal(row.perenual_end_to_end_total, 5);
  assert.equal(row.perenual_end_to_end_percent, 40);
});

test("discoverTraitNames: only traits actually observed appear, nothing invented", () => {
  const normalized = [plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match", traitValue: 100 })];
  assert.deepEqual(discoverTraitNames(normalized), ["height_max_cm"]);
});

test("computeCoverage: every BENCHMARK_TRAIT is present at 0% when no plant carries it, never silently dropped", () => {
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match" }), // eligible, but traits: {}
  ];
  const rows = computeCoverage(normalized);
  assert.equal(rows.length, BENCHMARK_TRAITS.length);
  const traitsReturned = rows.map((r) => r.trait);
  assert.deepEqual(traitsReturned, BENCHMARK_TRAITS);
  const growthForm = rows.find((r) => r.trait === "growth_form");
  assert.equal(growthForm.perenual_found, 0);
  assert.equal(growthForm.perenual_conditional_percent, 0);
  assert.equal(growthForm.perenual_end_to_end_percent, 0);
});

test("computeExtraDiscoveredTraitCoverage: a genuinely discovered non-canonical trait appears separately, without altering BENCHMARK_TRAITS", () => {
  const normalized = [
    {
      input_type: "species",
      providers: {
        perenual: { selection_reason: "exact_scientific_match" },
        trefle: { selection_reason: "skipped_no_key" },
      },
      traits: {
        height_max_cm: { trait: "height_max_cm", observations: [{ provider: "perenual", normalized_value: 300 }] },
        atmospheric_humidity: { trait: "atmospheric_humidity", observations: [{ provider: "perenual", normalized_value: "high" }] },
      },
    },
  ];

  assert.ok(!BENCHMARK_TRAITS.includes("atmospheric_humidity"));

  const canonicalRows = computeCoverage(normalized);
  assert.ok(!canonicalRows.some((r) => r.trait === "atmospheric_humidity"));

  const extraRows = computeExtraDiscoveredTraitCoverage(normalized);
  assert.deepEqual(extraRows.map((r) => r.trait), ["atmospheric_humidity"]);
  assert.equal(extraRows[0].perenual_found, 1);
  assert.equal(extraRows[0].perenual_conditional_percent, 100);

  // BENCHMARK_TRAITS itself must be untouched by discovering an extra trait.
  assert.ok(!BENCHMARK_TRAITS.includes("atmospheric_humidity"));
});

// --- unresolved_under_plan ------------------------------------------------

test("computeUnresolvedUnderPlanCount / computePlanRestrictedCount: distinct counts, never conflated", () => {
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "unresolved_under_plan" }),
    plant({ inputType: "species", provider: "perenual", reason: "unresolved_under_plan" }),
    plant({ inputType: "species", provider: "perenual", reason: "plan_restricted" }),
    plant({ inputType: "species", provider: "perenual", reason: "not_found" }),
  ];
  assert.equal(computeUnresolvedUnderPlanCount(normalized, "perenual"), 2);
  assert.equal(computePlanRestrictedCount(normalized, "perenual"), 1);
});

test("unresolved_under_plan #5: excluded from eligibleCount / record coverage / conditional trait coverage denominators", () => {
  const normalized = [
    plant({ inputType: "species", provider: "perenual", reason: "exact_scientific_match", traitValue: 100 }),
    plant({ inputType: "species", provider: "perenual", reason: "unresolved_under_plan" }),
    plant({ inputType: "species", provider: "perenual", reason: "unresolved_under_plan" }),
  ];
  // Only the one exact_scientific_match plant is eligible — the two
  // unresolved_under_plan plants never inflate or deflate the denominator.
  assert.equal(eligibleCount(normalized, "perenual"), 1);
  const record = computeRecordCoverage(normalized, "perenual");
  assert.deepEqual(record, { found: 1, total: 3, percent: 33.3 });

  const rows = computeCoverage(normalized);
  const row = rows.find((r) => r.trait === "height_max_cm");
  assert.equal(row.perenual_conditional_total, 1);
  assert.equal(row.perenual_conditional_percent, 100);
});
