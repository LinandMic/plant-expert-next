import { test } from "node:test";
import assert from "node:assert/strict";

import { proposeSelections } from "../src/selections.js";

function obs(overrides) {
  return {
    observation_ref: "acer_palmatum_species:perenual:height_max_cm",
    catalog_ref: "acer_palmatum_species",
    trait: "height_max_cm",
    provider: "perenual",
    normalized_value: 609.6,
    raw_value: 20,
    ...overrides,
  };
}

// Test #11: a hardiness observation exists, but plant_catalog's
// hardiness_min_rank/hardiness_max_rank is never auto-selected — the USDA
// crosswalk does not exist yet.
test("#11: hardiness observation present, but no hardiness_min_rank/hardiness_max_rank selection is ever proposed", () => {
  const observations = [
    obs({ observation_ref: "acer_palmatum_species:perenual:hardiness_min", trait: "hardiness_min", normalized_value: 6 }),
    obs({ observation_ref: "acer_palmatum_species:perenual:hardiness_max", trait: "hardiness_max", normalized_value: 6 }),
  ];
  const { selections, warnings } = proposeSelections({ catalogRef: "acer_palmatum_species", observations });

  assert.ok(!selections.some((s) => s.trait === "hardiness_min_rank" || s.trait === "hardiness_max_rank"));
  assert.ok(warnings.some((w) => w.includes("hardiness crosswalk not yet defined")));
});

// Test #14: every proposed selection's observation_ref must exist among
// the observations it was built from — never a dangling reference.
test("#14: no proposed selection points to an absent observation", () => {
  const observations = [
    obs({ observation_ref: "acer_palmatum_species:perenual:height_max_cm", trait: "height_max_cm", normalized_value: 609.6 }),
    obs({ observation_ref: "acer_palmatum_species:perenual:height_min_cm", trait: "height_min_cm", normalized_value: 609.6 }),
    obs({ observation_ref: "acer_palmatum_species:perenual:plant_type", trait: "plant_type", normalized_value: "tree" }),
    obs({ observation_ref: "acer_palmatum_species:perenual:sun", trait: "sun", raw_value: ["full sun", "part shade"], normalized_value: null }),
  ];
  const { selections } = proposeSelections({ catalogRef: "acer_palmatum_species", observations });

  const knownRefs = new Set(observations.map((o) => o.observation_ref));
  assert.ok(selections.length > 0, "expected at least one proposed selection for this fixture");
  for (const selection of selections) {
    assert.ok(knownRefs.has(selection.observation_ref), `selection for ${selection.trait} points to unknown observation_ref ${selection.observation_ref}`);
  }
});

test("height_min_cm/height_max_cm proposed as status=proposed when a single deterministic observation exists", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 609.6 })];
  const { selections } = proposeSelections({ catalogRef: "acer_palmatum_species", observations });
  const sel = selections.find((s) => s.trait === "height_max_cm");
  assert.ok(sel);
  assert.equal(sel.status, "proposed");
  assert.equal(sel.normalized_value, 609.6);
});

test("conflicting observed values for the same trait produce a warning and no selection", () => {
  const observations = [
    obs({ observation_ref: "a", trait: "height_max_cm", normalized_value: 609.6 }),
    obs({ observation_ref: "b", trait: "height_max_cm", normalized_value: 300 }),
  ];
  const { selections, warnings } = proposeSelections({ catalogRef: "acer_palmatum_species", observations });
  assert.ok(!selections.some((s) => s.trait === "height_max_cm"));
  assert.ok(warnings.some((w) => w.includes("conflicting")));
});

test("sun selection proposed from crosswalked values, partial mapping still proposes with a warning", () => {
  const observations = [obs({ observation_ref: "s", trait: "sun", raw_value: ["full sun", "part shade", "dappled sun"], normalized_value: null })];
  const { selections, warnings } = proposeSelections({ catalogRef: "acer_palmatum_species", observations });
  const sel = selections.find((s) => s.trait === "sun");
  assert.ok(sel);
  assert.deepEqual(sel.normalized_value, ["full_sun", "partial_sun"]);
  assert.ok(warnings.some((w) => w.includes("dappled sun")));
});

test("no observations at all -> no selections, no crash", () => {
  const { selections, warnings } = proposeSelections({ catalogRef: "acer_palmatum_species", observations: [] });
  assert.deepEqual(selections, []);
  assert.deepEqual(warnings, []);
});
