import { test } from "node:test";
import assert from "node:assert/strict";

import { compileSelections } from "../../src/plan/compileSelections.js";

function catalogEntry(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", entry_type: "species", ...overrides };
}

function compiledObs(overrides = {}) {
  return { observation_ref: "acer_palmatum_species:perenual:height_max_cm", catalog_ref: "acer_palmatum_species", trait: "height_max_cm", normalized_value: 609.6, ...overrides };
}

function rawSelection(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", trait: "height_max_cm", observation_ref: "acer_palmatum_species:perenual:height_max_cm", normalized_value: 609.6, status: "proposed", ...overrides };
}

test("compiles a selection into decision_method/decided_by/note, and promotes the catalog column in the same step", () => {
  const catalogEntries = [catalogEntry()];
  const { selections, errors } = compileSelections([{ trait_selections: [rawSelection()] }], [compiledObs()], catalogEntries);
  assert.deepEqual(errors, []);
  assert.equal(selections.length, 1);
  assert.equal(selections[0].decision_method, "provider_observation");
  assert.equal(selections[0].decided_by, null);
  assert.ok(selections[0].note.length > 0);
  assert.equal("status" in selections[0], false); // status="proposed" never leaks into the plan's DB-shaped selection
  assert.equal(catalogEntries[0].height_max_cm, 609.6);
});

// Item 10: a selection whose referenced observation belongs to a
// DIFFERENT trait (or catalog_ref) is rejected.
test("10: a selection referencing an observation of the wrong trait is rejected", () => {
  const wrongTraitObs = compiledObs({ observation_ref: "acer_palmatum_species:perenual:plant_type", trait: "plant_type", normalized_value: "tree" });
  const sel = rawSelection({ observation_ref: "acer_palmatum_species:perenual:plant_type" }); // trait still says height_max_cm
  const { errors } = compileSelections([{ trait_selections: [sel] }], [wrongTraitObs], [catalogEntry()]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "SELECTION_OBSERVATION_SCOPE_MISMATCH");
});

test("10 bis: a selection referencing an observation of the wrong catalog_ref is rejected", () => {
  const wrongCatalogObs = compiledObs({ observation_ref: "acer_palmatum_bloodgood:perenual:height_max_cm", catalog_ref: "acer_palmatum_bloodgood" });
  const sel = rawSelection({ observation_ref: "acer_palmatum_bloodgood:perenual:height_max_cm" });
  const { errors } = compileSelections([{ trait_selections: [sel] }], [wrongCatalogObs], [catalogEntry()]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "SELECTION_OBSERVATION_SCOPE_MISMATCH");
});

// Item 13: two selections for the same catalog_ref+trait -> rejected.
test("13: a duplicate selection for the same catalog_ref+trait is rejected", () => {
  const { errors } = compileSelections([{ trait_selections: [rawSelection(), rawSelection()] }], [compiledObs()], [catalogEntry()]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "DUPLICATE_SELECTION");
});

test("a selection referencing an observation absent from the plan is rejected", () => {
  const { errors } = compileSelections([{ trait_selections: [rawSelection({ observation_ref: "nowhere" })] }], [compiledObs()], [catalogEntry()]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "SELECTION_OBSERVATION_NOT_IN_PLAN");
});
