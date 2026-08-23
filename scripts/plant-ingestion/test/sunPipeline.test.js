import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDeterministicNormalizations } from "../src/normalization.js";
import { proposeSelections } from "../src/selections.js";

function sunObs(rawValue) {
  return {
    observation_ref: "acer_palmatum_species:perenual:sun",
    catalog_ref: "acer_palmatum_species",
    trait: "sun",
    provider: "perenual",
    raw_value: rawValue,
    normalized_value: rawValue, // reused benchmark's own passthrough default, pre-normalization
    uncertain: false,
  };
}

// Full pipeline: applyDeterministicNormalizations then proposeSelections —
// exactly the order bundle.js runs them in.
function runSunPipeline(rawValue) {
  const { observations, warnings: normWarnings } = applyDeterministicNormalizations([sunObs(rawValue)]);
  const { selections, warnings: selWarnings } = proposeSelections({ observations });
  return { observations, warnings: [...normWarnings, ...selWarnings], selections };
}

test("sun pipeline: fully mappable array -> observation normalized, selection proposed", () => {
  const { observations, warnings, selections } = runSunPipeline(["Full sun", "part shade"]);
  assert.deepEqual(observations[0].normalized_value, ["full_sun", "partial_sun"]);
  assert.deepEqual(warnings, []);
  const sel = selections.find((s) => s.trait === "sun");
  assert.ok(sel);
  assert.deepEqual(sel.normalized_value, ["full_sun", "partial_sun"]);
});

// The real Bloodgood live case: ["full sun", "part sun/part shade"].
test("sun pipeline: partially mappable array -> observation normalized_value null, warning, no sun selection", () => {
  const { observations, warnings, selections } = runSunPipeline(["full sun", "part sun/part shade"]);
  assert.equal(observations[0].normalized_value, null);
  // raw_value keeps BOTH provider values regardless.
  assert.deepEqual(observations[0].raw_value, ["full sun", "part sun/part shade"]);
  assert.ok(warnings.some((w) => w.includes('sun crosswalk: unmapped provider value "part sun/part shade"')));
  assert.ok(!selections.some((s) => s.trait === "sun"));
});

test("sun pipeline: entirely unmappable array -> observation normalized_value null, warning, no sun selection", () => {
  const { observations, warnings, selections } = runSunPipeline(["dappled sun", "deep shade"]);
  assert.equal(observations[0].normalized_value, null);
  assert.equal(warnings.length, 2);
  assert.ok(!selections.some((s) => s.trait === "sun"));
});

// Generic invariant (spec §2): for EVERY proposed selection, its
// normalized_value must be deeply equal to the normalized_value of the
// observation it references — never an independently recomputed value.
test("invariant: selection.normalized_value === referenced observation.normalized_value (sun case)", () => {
  const { observations, selections } = runSunPipeline(["Full sun", "part shade"]);
  const byRef = Object.fromEntries(observations.map((o) => [o.observation_ref, o]));
  for (const selection of selections) {
    assert.deepEqual(selection.normalized_value, byRef[selection.observation_ref].normalized_value);
  }
});
