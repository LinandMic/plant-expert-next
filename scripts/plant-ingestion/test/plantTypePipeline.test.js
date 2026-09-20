import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDeterministicNormalizations } from "../src/normalization.js";
import { proposeSelections } from "../src/selections.js";

function plantTypeObs(rawValue) {
  return {
    observation_ref: "acer_palmatum_species:perenual:plant_type",
    catalog_ref: "acer_palmatum_species",
    trait: "plant_type",
    provider: "perenual",
    raw_value: rawValue,
    normalized_value: rawValue, // reused benchmark's own passthrough default, pre-normalization
    uncertain: false,
  };
}

// Full pipeline: applyDeterministicNormalizations then proposeSelections —
// exactly the order bundle.js runs them in. Mirrors sunPipeline.test.js for
// the plant_type crosswalk added after auditing mini-batch-2 (real Perenual
// values: "Tree" for Betula pendula, "Broadleaf evergreen" for Buxus
// sempervirens — the latter is exactly the value that had already leaked,
// unnormalized, into production for Camellia japonica before this fix).
//
// plant_type auto-selection itself was removed after auditing batch-12,
// 2026-09 (trust-policy change, see selections.js's DETERMINISTIC_TRAITS
// comment) — a syntactically canonical value from a single provider is no
// longer sufficient evidence. Normalization (this file's real subject) is
// completely unaffected: the crosswalk still runs exactly as before, still
// produces a canonical normalized_value or null-plus-warning, only the
// promotion into a trait_selection is now permanently withheld here.
function runPlantTypePipeline(rawValue) {
  const { observations, warnings: normWarnings } = applyDeterministicNormalizations([plantTypeObs(rawValue)]);
  const { selections, warnings: selWarnings } = proposeSelections({ observations });
  return { observations, warnings: [...normWarnings, ...selWarnings], selections };
}

test('plant_type pipeline: Perenual "Tree" -> observation normalized to canonical "tree", but NO selection is auto-proposed (single-provider trust policy)', () => {
  const { observations, warnings, selections } = runPlantTypePipeline("Tree");
  assert.equal(observations[0].normalized_value, "tree");
  assert.deepEqual(warnings, []);
  assert.ok(!selections.some((s) => s.trait === "plant_type"), "a syntactically canonical single-provider plant_type must never be auto-selected");
});

// The real mini-batch-2 Buxus case: no safe crosswalk exists for this
// string (it could plausibly be a shrub or a small tree — never guessed).
test('plant_type pipeline: Perenual "Broadleaf evergreen" -> observation normalized_value null, warning, NO auto-selection', () => {
  const { observations, warnings, selections } = runPlantTypePipeline("Broadleaf evergreen");
  assert.equal(observations[0].normalized_value, null);
  // raw_value is preserved regardless — this is real provenance, just not promotable.
  assert.equal(observations[0].raw_value, "Broadleaf evergreen");
  assert.ok(warnings.some((w) => w.includes('plant_type crosswalk: unmapped provider value "Broadleaf evergreen"')));
  assert.ok(!selections.some((s) => s.trait === "plant_type"));
});

test("plant_type pipeline: an unknown/unmapped value never crashes and never fabricates a selection", () => {
  const { observations, warnings, selections } = runPlantTypePipeline("Herbaceous perennial climber");
  assert.equal(observations[0].normalized_value, null);
  assert.equal(warnings.length, 1);
  assert.ok(!selections.some((s) => s.trait === "plant_type"));
});

// Generic invariant (spec §2), same as sunPipeline.test.js: for EVERY
// proposed selection, its normalized_value must be deeply equal to the
// normalized_value of the observation it references.
test("invariant: selection.normalized_value === referenced observation.normalized_value (plant_type case)", () => {
  const { observations, selections } = runPlantTypePipeline("Shrub");
  const byRef = Object.fromEntries(observations.map((o) => [o.observation_ref, o]));
  for (const selection of selections) {
    assert.deepEqual(selection.normalized_value, byRef[selection.observation_ref].normalized_value);
  }
});

// ===========================================================================
// batch-12 regression: real Mac run flagged Perenual returning a
// syntactically canonical but biologically unreliable plant_type for
// herbaceous plants — "Shrub" for Alcea rosea (a biennial/short-lived
// perennial) and for Brunnera macrophylla (a herbaceous perennial), and
// "Tree" for Alnus glutinosa (correct in that instance, but from the same
// single, unverified source). None of these were an unmapped-string case —
// crosswalkPlantTypeValue matched exactly, so the pre-existing crosswalk
// gate alone was never going to catch this. Fixed as a TRUST-policy change:
// plant_type removed from DETERMINISTIC_TRAITS entirely (selections.js) —
// never a family/genus/growth_form inference either.
// ===========================================================================

test('plant_type pipeline: Perenual "Shrub" -> observation normalized to canonical "shrub", but NO selection is auto-proposed (real Alcea rosea / Brunnera macrophylla regression)', () => {
  const { observations, warnings, selections } = runPlantTypePipeline("Shrub");
  assert.equal(observations[0].normalized_value, "shrub");
  assert.deepEqual(warnings, []);
  assert.ok(!selections.some((s) => s.trait === "plant_type"));
});

test("plant_type pipeline: even TWO providers agreeing on the same canonical value never produce a plant_type selection (single-provider trust policy applies regardless of agreement count)", () => {
  const observations = applyDeterministicNormalizations([
    plantTypeObs("Tree"),
    { ...plantTypeObs("tree"), observation_ref: "acer_palmatum_species:trefle:plant_type", provider: "trefle" },
  ]).observations;
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "plant_type"));
  // Both observations still exist, both still normalized.
  assert.equal(observations.filter((o) => o.trait === "plant_type" && o.normalized_value === "tree").length, 2);
});
