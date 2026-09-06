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
  const { selections, warnings } = proposeSelections({ observations });

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
  const { selections } = proposeSelections({ observations });

  const knownRefs = new Set(observations.map((o) => o.observation_ref));
  assert.ok(selections.length > 0, "expected at least one proposed selection for this fixture");
  for (const selection of selections) {
    assert.ok(knownRefs.has(selection.observation_ref), `selection for ${selection.trait} points to unknown observation_ref ${selection.observation_ref}`);
  }
});

test("height_min_cm/height_max_cm proposed as status=proposed when a single deterministic observation exists", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 609.6 })];
  const { selections } = proposeSelections({ observations });
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
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "height_max_cm"));
  assert.ok(warnings.some((w) => w.includes("conflicting")));
});

// proposeSun (selections.js) never recomputes the sun crosswalk itself — it
// only ever copies an already-normalized observation.normalized_value
// verbatim (see normalization.js / test/sunPipeline.test.js for the actual
// crosswalk behavior, including the all-or-nothing rule). At this level,
// the only thing to verify is that a null (incomplete/unmapped)
// normalized_value never produces a selection, and a fully-normalized one
// does, copied exactly.
test("sun selection: an already-normalized (non-null) observation produces a selection with the SAME normalized_value", () => {
  const observations = [obs({ observation_ref: "s", trait: "sun", raw_value: ["full sun", "part shade"], normalized_value: ["full_sun", "partial_sun"] })];
  const { selections } = proposeSelections({ observations });
  const sel = selections.find((s) => s.trait === "sun");
  assert.ok(sel);
  assert.deepEqual(sel.normalized_value, ["full_sun", "partial_sun"]);
});

test("sun selection: a null normalized_value (incomplete crosswalk) never proposes a selection", () => {
  const observations = [obs({ observation_ref: "s", trait: "sun", raw_value: ["full sun", "dappled sun"], normalized_value: null })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "sun"));
});

test("no observations at all -> no selections, no crash", () => {
  const { selections, warnings } = proposeSelections({ observations: [] });
  assert.deepEqual(selections, []);
  assert.deepEqual(warnings, []);
});

// Regression: real mini-batch-2 case — Perenual returned a second candidate
// for Miscanthus sinensis ("Miscanthus sinensis 'Autumn Light'") that was
// correctly classified taxonomy_match_type=ambiguous/unresolved_under_plan
// upstream (see taxonomyAmbiguity.js), which marks every observation from
// that source record uncertain:true (see bundle.js's applyTaxonomyAmbiguity).
// eligible() must exclude such observations from selection consideration
// even when their normalized_value is otherwise perfectly well-formed — an
// uncertain match is never eligible for an automatic proposal, whatever
// trait it's for. This was previously only covered indirectly (at the
// taxonomyAmbiguity.js unit level and via bundle.js wiring), never as a
// direct proposeSelections()-level regression test.
test("an uncertain (ambiguous-match) observation is never eligible for selection, even with a well-formed normalized_value", () => {
  const observations = [obs({ observation_ref: "m1", trait: "growth_form", provider: "perenual", normalized_value: "Bunch", uncertain: true })];
  const { selections } = proposeSelections({ observations });
  assert.equal(selections.length, 0);
});

test("an uncertain plant_type observation is never selected, even after a valid crosswalk value", () => {
  const observations = [obs({ observation_ref: "m2", trait: "plant_type", provider: "perenual", normalized_value: "tree", uncertain: true })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "plant_type"));
});

// ===========================================================================
// growth_form / spread_max_cm / evergreen / flowering_months — extended
// DETERMINISTIC_TRAITS, reusing proposeDeterministicNumericOrPassthrough
// exactly as-is (no new resolver, no crosswalk, no provider priority).
// Each trait: A (single observation), B (two providers, same value), C (two
// providers, differing values), D (no observation).
// ===========================================================================

// --- growth_form (string) -----------------------------------------------
// growth_form has NO canonical vocabulary anywhere in this codebase (no DB
// CHECK, no application whitelist — confirmed by editorial/editorialVocab.js's
// own note) — removed from DETERMINISTIC_TRAITS after auditing mini-batch-2
// (Betula's Trefle "Thicket Forming" would otherwise have been auto-selected
// verbatim). It must NEVER auto-select, regardless of how many providers
// agree — this is a hard "never promote" rule, not a per-value crosswalk
// gap like plant_type/sun, so there is no "unmapped value" warning either:
// the trait is simply never a candidate for selection at all.

test("growth_form A: a single observation NEVER produces a selection (no canonical vocabulary exists)", () => {
  const observations = [obs({ observation_ref: "gf1", trait: "growth_form", provider: "trefle", normalized_value: "Thicket Forming" })];
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "growth_form"));
  assert.ok(!warnings.some((w) => w.includes("growth_form")), "growth_form should be silently never-proposed, not warned about — it isn't a crosswalk gap");
});

test("growth_form B: two different providers agreeing on the same value STILL never produce a selection", () => {
  const observations = [
    obs({ observation_ref: "gf1", trait: "growth_form", provider: "trefle", normalized_value: "shrub" }),
    obs({ observation_ref: "gf2", trait: "growth_form", provider: "perenual", normalized_value: "shrub" }),
  ];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "growth_form"));
});

test("growth_form C: two providers with differing values still never produce a selection or a conflict warning", () => {
  const observations = [
    obs({ observation_ref: "gf1", trait: "growth_form", provider: "trefle", normalized_value: "shrub" }),
    obs({ observation_ref: "gf2", trait: "growth_form", provider: "perenual", normalized_value: "tree" }),
  ];
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "growth_form"));
  assert.ok(!warnings.some((w) => w.includes("growth_form")));
});

test("growth_form D: no observation at all -> no selection", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 200 })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "growth_form"));
});

// --- spread_max_cm (number) --------------------------------------------

test("spread_max_cm A: a single observation produces a selection", () => {
  const observations = [obs({ observation_ref: "sp1", trait: "spread_max_cm", provider: "trefle", normalized_value: 150 })];
  const { selections } = proposeSelections({ observations });
  const sel = selections.find((s) => s.trait === "spread_max_cm");
  assert.ok(sel);
  assert.equal(sel.normalized_value, 150);
});

test("spread_max_cm B: two providers agreeing on the same numeric value produce one selection", () => {
  const observations = [
    obs({ observation_ref: "sp1", trait: "spread_max_cm", provider: "trefle", normalized_value: 150 }),
    obs({ observation_ref: "sp2", trait: "spread_max_cm", provider: "perenual", normalized_value: 150 }),
  ];
  const { selections } = proposeSelections({ observations });
  const matches = selections.filter((s) => s.trait === "spread_max_cm");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].normalized_value, 150);
});

test("spread_max_cm C: two providers with differing numeric values produce no selection", () => {
  const observations = [
    obs({ observation_ref: "sp1", trait: "spread_max_cm", provider: "trefle", normalized_value: 150 }),
    obs({ observation_ref: "sp2", trait: "spread_max_cm", provider: "perenual", normalized_value: 200 }),
  ];
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "spread_max_cm"));
  assert.ok(warnings.some((w) => w.includes("spread_max_cm") && w.includes("conflicting")));
});

test("spread_max_cm D: no observation at all -> no selection", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 200 })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "spread_max_cm"));
});

// --- evergreen (boolean) -------------------------------------------------

test("evergreen A: a single observation produces a selection, including a false value (false IS informative)", () => {
  const observations = [obs({ observation_ref: "ev1", trait: "evergreen", provider: "trefle", normalized_value: false })];
  const { selections } = proposeSelections({ observations });
  const sel = selections.find((s) => s.trait === "evergreen");
  assert.ok(sel);
  assert.equal(sel.normalized_value, false);
});

test("evergreen B: two providers agreeing (both true) produce one selection", () => {
  const observations = [
    obs({ observation_ref: "ev1", trait: "evergreen", provider: "trefle", normalized_value: true }),
    obs({ observation_ref: "ev2", trait: "evergreen", provider: "perenual", normalized_value: true }),
  ];
  const { selections } = proposeSelections({ observations });
  const matches = selections.filter((s) => s.trait === "evergreen");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].normalized_value, true);
});

test("evergreen C: two providers disagreeing (true vs false) produce no selection", () => {
  const observations = [
    obs({ observation_ref: "ev1", trait: "evergreen", provider: "trefle", normalized_value: true }),
    obs({ observation_ref: "ev2", trait: "evergreen", provider: "perenual", normalized_value: false }),
  ];
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "evergreen"));
  assert.ok(warnings.some((w) => w.includes("evergreen") && w.includes("conflicting")));
});

test("evergreen D: no observation at all -> no selection", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 200 })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "evergreen"));
});

// --- flowering_months (array, already canonical by the time it reaches
// selections.js — see normalization.js/trefle.js's normalizeMonthCodes;
// this level never reorders, it only compares whatever normalized_value
// already is) -------------------------------------------------------------

test("flowering_months A: a single observation produces a selection with the canonical array untouched", () => {
  const observations = [obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [4, 5] })];
  const { selections } = proposeSelections({ observations });
  const sel = selections.find((s) => s.trait === "flowering_months");
  assert.ok(sel);
  assert.deepEqual(sel.normalized_value, [4, 5]);
});

test("flowering_months B: two providers agreeing on the same canonical array produce one selection", () => {
  const observations = [
    obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [4, 5] }),
    obs({ observation_ref: "fm2", trait: "flowering_months", provider: "perenual", normalized_value: [4, 5] }),
  ];
  const { selections } = proposeSelections({ observations });
  const matches = selections.filter((s) => s.trait === "flowering_months");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].normalized_value, [4, 5]);
});

test("flowering_months C: two providers with differing month arrays produce no selection", () => {
  const observations = [
    obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [4, 5] }),
    obs({ observation_ref: "fm2", trait: "flowering_months", provider: "perenual", normalized_value: [6, 7] }),
  ];
  const { selections, warnings } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "flowering_months"));
  assert.ok(warnings.some((w) => w.includes("flowering_months") && w.includes("conflicting")));
});

test("flowering_months D: no observation at all -> no selection", () => {
  const observations = [obs({ trait: "height_max_cm", normalized_value: 200 })];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "flowering_months"));
});

// Regression: real mini-batch-5 Mac run — Dryopteris filix-mas (a fern)
// correctly got plant_type="fern" from Perenual, but Trefle also proposed a
// clean, unconflicting flowering_months=[6,7,8,9,10] that would have been
// auto-selected verbatim despite ferns never flowering (they reproduce by
// spores). The observation itself must survive (real provenance, not an
// error) — only the trait_selection must never be created.
test("flowering_months E: plant_type=fern blocks the flowering_months selection, even with a single clean provider observation", () => {
  const observations = [
    obs({ observation_ref: "pt1", trait: "plant_type", provider: "perenual", normalized_value: "fern" }),
    obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [6, 7, 8, 9, 10] }),
  ];
  const { selections, warnings } = proposeSelections({ observations });

  // plant_type itself must remain fully selectable — the guard only ever
  // targets flowering_months, never plant_type's own promotion.
  const plantTypeSel = selections.find((s) => s.trait === "plant_type");
  assert.ok(plantTypeSel);
  assert.equal(plantTypeSel.normalized_value, "fern");

  assert.ok(!selections.some((s) => s.trait === "flowering_months"));
  assert.ok(warnings.some((w) => w.includes('flowering_months: plant_type is "fern"')));

  // The observation array itself is untouched by this — proposeSelections
  // never mutates or drops observations, only decides what to select.
  assert.ok(observations.some((o) => o.trait === "flowering_months" && o.provider === "trefle"));
});

test("flowering_months F: plant_type=perennial (a real flowering plant_type) still selects flowering_months normally", () => {
  const observations = [
    obs({ observation_ref: "pt1", trait: "plant_type", provider: "perenual", normalized_value: "perennial" }),
    obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [6, 7, 8] }),
  ];
  const { selections } = proposeSelections({ observations });
  const sel = selections.find((s) => s.trait === "flowering_months");
  assert.ok(sel);
  assert.deepEqual(sel.normalized_value, [6, 7, 8]);
});

test("flowering_months G: no plant_type observation at all -> flowering_months still selects normally (guard only fires on a confirmed fern)", () => {
  const observations = [obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [4, 5] })];
  const { selections } = proposeSelections({ observations });
  assert.ok(selections.some((s) => s.trait === "flowering_months"));
});

test("flowering_months H: conflicting plant_type observations (no plant_type selection resolved) never trigger the fern guard — flowering_months still selects normally", () => {
  const observations = [
    obs({ observation_ref: "pt1", trait: "plant_type", provider: "perenual", normalized_value: "fern" }),
    obs({ observation_ref: "pt2", trait: "plant_type", provider: "trefle", normalized_value: "perennial" }),
    obs({ observation_ref: "fm1", trait: "flowering_months", provider: "trefle", normalized_value: [4, 5] }),
  ];
  const { selections } = proposeSelections({ observations });
  assert.ok(!selections.some((s) => s.trait === "plant_type"), "conflicting plant_type must not resolve to a selection");
  assert.ok(selections.some((s) => s.trait === "flowering_months"), "an unresolved plant_type must never speculatively block flowering_months");
});

// ===========================================================================
// Pilot batch regression: the 4 new traits must never interfere with the
// existing height_min_cm/height_max_cm/plant_type/sun selections — a
// Camellia-like fixture (plant_type + sun already selectable, matching the
// real production 2-selection case) and a Hydrangea-like fixture (only
// growth_form available, no plant_type/sun since Perenual was unavailable).
// ===========================================================================

test("PILOT BATCH: Camellia-like fixture keeps its 2 existing selections (plant_type, sun) unchanged after adding the 4 new traits", () => {
  const observations = [
    obs({ observation_ref: "c1", trait: "plant_type", provider: "perenual", normalized_value: "shrub" }),
    obs({ observation_ref: "c2", trait: "sun", provider: "perenual", raw_value: ["full sun"], normalized_value: ["full_sun"] }),
    obs({ observation_ref: "c3", trait: "height_max_cm", provider: "perenual", normalized_value: 450 }),
  ];
  const { selections } = proposeSelections({ observations });
  const traits = selections.map((s) => s.trait).sort();
  assert.deepEqual(traits, ["height_max_cm", "plant_type", "sun"]);
});

test("PILOT BATCH: Hydrangea-like fixture (Perenual unavailable, only Trefle growth_form observed) never gets a growth_form selection (no canonical vocabulary), still nothing for plant_type/sun", () => {
  const observations = [
    obs({ observation_ref: "h1", trait: "growth_form", provider: "trefle", normalized_value: "shrub" }),
    obs({ observation_ref: "h2", trait: "spread_max_cm", provider: "trefle", normalized_value: 180 }),
    obs({ observation_ref: "h3", trait: "evergreen", provider: "trefle", normalized_value: false }),
    obs({ observation_ref: "h4", trait: "flowering_months", provider: "trefle", normalized_value: [6, 7, 8] }),
  ];
  const { selections } = proposeSelections({ observations });
  const traits = selections.map((s) => s.trait).sort();
  assert.deepEqual(traits, ["evergreen", "flowering_months", "spread_max_cm"]);
  // growth_form never promotes, regardless of provider agreement (see growth_form A/B/C above).
  assert.ok(!traits.includes("growth_form"));
  // Structurally impossible without Perenual — confirmed still absent.
  assert.ok(!traits.includes("plant_type"));
  assert.ok(!traits.includes("sun"));
});
