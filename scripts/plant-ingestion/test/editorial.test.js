import { test } from "node:test";
import assert from "node:assert/strict";

import { validateEditorialInput } from "../src/editorial/validateEditorialInput.js";
import { buildEditorialObservation } from "../src/editorial/buildEditorialObservation.js";
import { buildManualSelection } from "../src/editorial/buildManualSelection.js";
import { buildEditorialPlan, guardEditorialPlan } from "../src/editorial/buildEditorialPlan.js";
import { checkEditorialPlanAgainstDb, buildCatalogSlugMap } from "../src/editorial/checkEditorialAgainstDb.js";
import { createFakeSupabaseClient } from "./apply/fakeSupabaseClient.js";

// Structural test fixtures only — no real horticultural claim is made or
// implied by any value below (spec: "AUCUNE DONNÉE HORTICOLE RÉELLE").
// catalog_ref reuses the same placeholder already established by
// test/apply/fixtures.js elsewhere in this suite. schema_version=2 format
// (curation object + restructured source) — see editorialVocab.js.
function validInput(overrides = {}) {
  return {
    schema_version: 2,
    catalog_ref: "acer_palmatum_species",
    trait: "sun",
    raw_value: ["full_sun"],
    normalized_value: ["full_sun"],
    curation: {
      method: "open_source_synthesis",
      license: "proprietary_internal_curation_v1",
    },
    source: {
      title: "Example Horticultural Reference",
      publisher: "Example Publisher",
      url: "https://example.invalid/reference",
      license: "CC-BY-4.0",
      retrieved_at: "2026-01-01T00:00:00.000Z",
    },
    review: {
      note: "Structural test fixture, not a real curation decision.",
      decided_by: null,
    },
    ...overrides,
  };
}

function expertKnowledgeInput(overrides = {}) {
  return {
    schema_version: 2,
    catalog_ref: "acer_palmatum_species",
    trait: "sun",
    raw_value: ["full_sun"],
    normalized_value: ["full_sun"],
    curation: {
      method: "expert_knowledge",
      license: "proprietary_internal_curation_v1",
    },
    source: null,
    review: {
      note: "Structural test fixture — expert judgement, not a real curation decision.",
      decided_by: null,
    },
    ...overrides,
  };
}

function hasErrorCode(errors, code) {
  return errors.some((e) => e.code === code);
}

// 1. sun valide
test("1: a valid open_source_synthesis sun input produces zero validation errors", () => {
  const errors = validateEditorialInput(validInput());
  assert.deepEqual(errors, []);
});

// 2. sun invalide
test("2: an out-of-vocabulary sun value is rejected", () => {
  const errors = validateEditorialInput(validInput({ normalized_value: ["full_sun", "partial_sun", "made_up_exposure"] }));
  assert.ok(hasErrorCode(errors, "NORMALIZED_VALUE_INVALID"));
});

// 3. plant_type valide
test("3: a valid plant_type input produces zero validation errors", () => {
  const errors = validateEditorialInput(validInput({ trait: "plant_type", raw_value: "shrub", normalized_value: "shrub" }));
  assert.deepEqual(errors, []);
});

// 4. plant_type invalide
test("4: an out-of-vocabulary plant_type value is rejected", () => {
  const errors = validateEditorialInput(validInput({ trait: "plant_type", raw_value: "houseplant", normalized_value: "houseplant" }));
  assert.ok(hasErrorCode(errors, "NORMALIZED_VALUE_INVALID"));
});

// 5. boolean
test("5: boolean traits (evergreen) accept a real boolean and reject a non-boolean", () => {
  const ok = validateEditorialInput(validInput({ trait: "evergreen", raw_value: true, normalized_value: true }));
  assert.deepEqual(ok, []);
  const bad = validateEditorialInput(validInput({ trait: "evergreen", raw_value: "yes", normalized_value: "yes" }));
  assert.ok(hasErrorCode(bad, "NORMALIZED_VALUE_INVALID"));
});

// 6. dimensions number
test("6: dimension traits (height_max_cm) accept a non-negative number and reject a non-number or negative value", () => {
  const ok = validateEditorialInput(validInput({ trait: "height_max_cm", raw_value: 150, normalized_value: 150 }));
  assert.deepEqual(ok, []);
  const badType = validateEditorialInput(validInput({ trait: "height_max_cm", raw_value: "tall", normalized_value: "tall" }));
  assert.ok(hasErrorCode(badType, "NORMALIZED_VALUE_INVALID"));
  const negative = validateEditorialInput(validInput({ trait: "height_max_cm", raw_value: -10, normalized_value: -10 }));
  assert.ok(hasErrorCode(negative, "NORMALIZED_VALUE_INVALID"));
});

// 7. flowering_months
test("7: flowering_months accepts integers 1-12 and rejects out-of-range values", () => {
  const ok = validateEditorialInput(validInput({ trait: "flowering_months", raw_value: [4, 5, 6], normalized_value: [4, 5, 6] }));
  assert.deepEqual(ok, []);
  const bad = validateEditorialInput(validInput({ trait: "flowering_months", raw_value: [0, 13], normalized_value: [0, 13] }));
  assert.ok(hasErrorCode(bad, "NORMALIZED_VALUE_INVALID"));
});

// 8. source_url manquante (open_source_synthesis)
test("8: a missing source.url is rejected for curation.method=open_source_synthesis", () => {
  const input = validInput();
  delete input.source.url;
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "SOURCE_URL_MISSING"));
});

// 9. attribution/title manquant
test("9: a missing source.title or source.publisher is rejected for open_source_synthesis", () => {
  const noTitle = validInput();
  delete noTitle.source.title;
  assert.ok(hasErrorCode(validateEditorialInput(noTitle), "SOURCE_TITLE_MISSING"));

  const noPublisher = validInput();
  delete noPublisher.source.publisher;
  assert.ok(hasErrorCode(validateEditorialInput(noPublisher), "SOURCE_PUBLISHER_MISSING"));
});

// 10. soil refusé
test("10: trait \"soil\" is explicitly rejected — no plant_catalog.soil column exists", () => {
  const errors = validateEditorialInput(validInput({ trait: "soil", raw_value: "well_drained", normalized_value: "well_drained" }));
  assert.ok(hasErrorCode(errors, "TRAIT_SOIL_NOT_SUPPORTED"));
});

// 11. non-promotable trait refusé
test("11: an unknown/non-promotable trait is rejected", () => {
  const errors = validateEditorialInput(validInput({ trait: "made_up_trait", raw_value: "x", normalized_value: "x" }));
  assert.ok(hasErrorCode(errors, "TRAIT_NOT_PROMOTABLE"));
});

// 12. deterministic observation_ref
test("12: buildEditorialObservation produces the same observation_ref for the same input, every time", () => {
  const input = validInput();
  const a = buildEditorialObservation(input);
  const b = buildEditorialObservation(input);
  assert.equal(a.observation_ref, b.observation_ref);
  assert.equal(a.observation_ref, "acer_palmatum_species:editorial:sun");
});

// 13. manual_resolution produit
test("13: buildManualSelection produces a manual_resolution selection pointing at the given observation_ref", () => {
  const input = validInput();
  const obs = buildEditorialObservation(input);
  const sel = buildManualSelection(input, obs.observation_ref);
  assert.equal(sel.decision_method, "manual_resolution");
  assert.equal(sel.selected_observation_ref, obs.observation_ref);
  assert.equal(sel.catalog_ref, input.catalog_ref);
  assert.equal(sel.trait, input.trait);
  assert.equal(sel.note, input.review.note);
});

// 14. jamais decision_method=editorial
test("14: buildManualSelection never produces decision_method=\"editorial\", even if the input tries to inject one", () => {
  const input = validInput({ decision_method: "editorial" }); // extraneous field, must be ignored
  const obs = buildEditorialObservation(input);
  const sel = buildManualSelection(input, obs.observation_ref);
  assert.equal(sel.decision_method, "manual_resolution");
  assert.notEqual(sel.decision_method, "editorial");
});

// 15. aucune source_record
test("15: buildEditorialObservation never references a source_record, and guardEditorialPlan rejects a plan that tries to add one", () => {
  const obs = buildEditorialObservation(validInput());
  assert.equal(obs.plant_source_record_id, null);
  assert.equal(obs.source_record_ref, null);

  const tamperedPlan = {
    mode: "editorial_plan",
    approval_required: true,
    editorial_observations: [{ ...obs, plant_source_record_id: "sneaky-id" }],
    manual_selections: [],
  };
  const errors = guardEditorialPlan(tamperedPlan);
  assert.ok(errors.some((e) => e.includes("must never reference a source_record")));
});

// 16. input non muté
test("16: validateEditorialInput and buildEditorialObservation never mutate the input object", () => {
  const input = validInput();
  const snapshot = JSON.parse(JSON.stringify(input));
  validateEditorialInput(input);
  buildEditorialObservation(input);
  buildManualSelection(input, "some:ref");
  assert.deepEqual(input, snapshot);
});

// 17. conflit manual_resolution simulé
test("17: checkEditorialPlanAgainstDb flags an existing manual_resolution selection as a protected conflict", async () => {
  const input = validInput();
  const plan = buildEditorialPlan([input]);
  const catalogSlugByRef = new Map([["acer_palmatum_species", "acer-palmatum"]]);

  const { client } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", slug: "acer-palmatum" }],
    plant_trait_observations: [],
    plant_trait_selections: [{ id: "sel-1", plant_catalog_id: "catalog-1", trait: "sun", decision_method: "manual_resolution" }],
  });

  const checks = await checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef });
  const selectionCheck = checks.find((c) => c.code === "SELECTION_MANUAL_RESOLUTION_PROTECTED");
  assert.ok(selectionCheck, "expected a SELECTION_MANUAL_RESOLUTION_PROTECTED check");
  assert.equal(selectionCheck.ok, false);
});

// 18. catalog_ref absent simulé
test("18: checkEditorialPlanAgainstDb flags a catalog_ref with no known slug, and one with no matching plant_catalog row", async () => {
  const input = validInput();
  const plan = buildEditorialPlan([input]);

  // 18a: no slug known at all for this catalog_ref
  const { client: client1 } = createFakeSupabaseClient({ plant_catalog: [] });
  const checks1 = await checkEditorialPlanAgainstDb({ client: client1, plan, catalogSlugByRef: new Map() });
  assert.equal(checks1.length, 1);
  assert.equal(checks1[0].code, "CATALOG_REF_UNKNOWN");
  assert.equal(checks1[0].ok, false);

  // 18b: slug known, but no matching row exists in plant_catalog
  const { client: client2 } = createFakeSupabaseClient({ plant_catalog: [] });
  const checks2 = await checkEditorialPlanAgainstDb({ client: client2, plan, catalogSlugByRef: new Map([["acer_palmatum_species", "acer-palmatum"]]) });
  assert.equal(checks2.length, 1);
  assert.equal(checks2[0].code, "CATALOG_ENTRY_NOT_FOUND");
  assert.equal(checks2[0].ok, false);
});

// ==================================================================
// Provenance model v2: curation.method branching (this round's spec).
// ==================================================================

// expert_knowledge sans source accepté
test("19: expert_knowledge with source=null is accepted", () => {
  const errors = validateEditorialInput(expertKnowledgeInput());
  assert.deepEqual(errors, []);
});

// expert_knowledge avec curation_license obligatoire
test("20: expert_knowledge without curation.license is rejected", () => {
  const input = expertKnowledgeInput();
  delete input.curation.license;
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "CURATION_LICENSE_MISSING"));
});

test("20b: expert_knowledge with a source object present is rejected — never fabricate a source", () => {
  const input = expertKnowledgeInput({ source: { title: "t", publisher: "p", url: "u", license: "l", retrieved_at: "2026-01-01T00:00:00.000Z" } });
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "SOURCE_MUST_BE_NULL_FOR_EXPERT_KNOWLEDGE"));
});

test("20c: expert_knowledge without review.note is rejected", () => {
  const input = expertKnowledgeInput({ review: { note: "", decided_by: null } });
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "REVIEW_NOTE_MISSING"));
});

// open_source_synthesis source obligatoire
test("21: open_source_synthesis with source=null is rejected", () => {
  const input = validInput({ source: null });
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "SOURCE_URL_MISSING"));
  assert.ok(hasErrorCode(errors, "SOURCE_TITLE_MISSING"));
  assert.ok(hasErrorCode(errors, "SOURCE_PUBLISHER_MISSING"));
  assert.ok(hasErrorCode(errors, "SOURCE_LICENSE_MISSING"));
});

// open_source_synthesis source_license obligatoire
test("22: open_source_synthesis without source.license is rejected, and \"unknown\" is never accepted", () => {
  const missing = validInput();
  delete missing.source.license;
  assert.ok(hasErrorCode(validateEditorialInput(missing), "SOURCE_LICENSE_MISSING"));

  const placeholder = validInput({ source: { ...validInput().source, license: "unknown" } });
  assert.ok(hasErrorCode(validateEditorialInput(placeholder), "SOURCE_LICENSE_UNKNOWN_NOT_ALLOWED"));
});

// source_retrieved_at obligatoire
test("23: open_source_synthesis without source.retrieved_at is rejected", () => {
  const input = validInput();
  delete input.source.retrieved_at;
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "SOURCE_RETRIEVED_AT_MISSING"));
});

// source_title/source_publisher écrits séparément
test("24: buildEditorialObservation writes source_title and source_publisher as separate fields, not just folded into attribution", () => {
  const obs = buildEditorialObservation(validInput());
  assert.equal(obs.source_title, "Example Horticultural Reference");
  assert.equal(obs.source_publisher, "Example Publisher");
  assert.equal(obs.attribution, "Example Horticultural Reference — Example Publisher");
});

// curation_license séparé de license
test("25: curation_license and license (source license) are independent fields, never conflated", () => {
  const obs = buildEditorialObservation(validInput());
  assert.equal(obs.license, "CC-BY-4.0"); // source license, unchanged semantics
  assert.equal(obs.curation_license, "proprietary_internal_curation_v1"); // our own synthesis's license
  assert.notEqual(obs.license, obs.curation_license);

  const expertObs = buildEditorialObservation(expertKnowledgeInput());
  assert.equal(expertObs.license, null); // no source consulted
  assert.equal(expertObs.curation_license, "proprietary_internal_curation_v1"); // still required and set
});

// restricted_source_paraphrase rejeté par validator
test("26: curation.method=\"restricted_source_paraphrase\" is rejected explicitly, not silently accepted or downgraded", () => {
  const input = validInput({ curation: { method: "restricted_source_paraphrase", license: "proprietary_internal_curation_v1" } });
  const errors = validateEditorialInput(input);
  assert.ok(hasErrorCode(errors, "CURATION_METHOD_NOT_ENABLED"));
});

// schema_version enforcement — old (v1-shaped, no schema_version/curation) inputs are rejected, never silently reinterpreted
test("27: an old (pre-v2) input without schema_version/curation is rejected with SCHEMA_VERSION_UNSUPPORTED, never silently accepted", () => {
  const oldShapedInput = {
    catalog_ref: "acer_palmatum_species",
    trait: "sun",
    raw_value: ["full_sun"],
    normalized_value: ["full_sun"],
    source: { title: "t", publisher: "p", url: "u", license: "CC-BY-4.0" },
    review: { note: "n", decided_by: null },
  };
  const errors = validateEditorialInput(oldShapedInput);
  assert.ok(hasErrorCode(errors, "SCHEMA_VERSION_UNSUPPORTED"));
});

test("28: buildEditorialPlan (guardEditorialPlan) rejects an expert_knowledge entry that carries source fields", () => {
  const obs = buildEditorialObservation(expertKnowledgeInput());
  const tamperedPlan = {
    mode: "editorial_plan",
    approval_required: true,
    editorial_observations: [{ ...obs, source_url: "https://sneaky.invalid" }],
    manual_selections: [buildManualSelection(expertKnowledgeInput(), obs.observation_ref)],
  };
  const errors = guardEditorialPlan(tamperedPlan);
  assert.ok(errors.some((e) => e.includes('curation_method="expert_knowledge" but carries source fields')));
});

// Additional coverage: buildEditorialPlan itself (multi-input, duplicates,
// overlay-only shape) and buildCatalogSlugMap.

test("buildEditorialPlan combines multiple inputs and never creates taxa/taxon_names/source_records/catalog_entries", () => {
  const plan = buildEditorialPlan([
    validInput({ trait: "sun" }),
    validInput({ trait: "plant_type", raw_value: "shrub", normalized_value: "shrub" }),
  ]);
  assert.equal(plan.mode, "editorial_plan");
  assert.equal(plan.approval_required, true);
  assert.equal(plan.editorial_observations.length, 2);
  assert.equal(plan.manual_selections.length, 2);
  assert.equal(plan.summary.editorial_observations, 2);
  assert.equal(plan.summary.manual_selections, 2);
  assert.equal(plan.taxa, undefined);
  assert.equal(plan.taxon_names, undefined);
  assert.equal(plan.source_records, undefined);
  assert.equal(plan.catalog_entries, undefined);
});

test("buildEditorialPlan combines expert_knowledge and open_source_synthesis entries in the same batch", () => {
  const plan = buildEditorialPlan([
    validInput({ trait: "sun" }),
    expertKnowledgeInput({ trait: "water_need", raw_value: "moderate", normalized_value: "moderate" }),
  ]);
  assert.equal(plan.editorial_observations.length, 2);
  assert.equal(plan.editorial_observations[0].curation_method, "open_source_synthesis");
  assert.equal(plan.editorial_observations[1].curation_method, "expert_knowledge");
});

test("buildEditorialPlan throws on a duplicate (catalog_ref, trait) pair rather than silently picking one", () => {
  assert.throws(() => buildEditorialPlan([validInput(), validInput()]), /duplicate editorial input/);
});

test("buildCatalogSlugMap extracts only catalog_ref/slug pairs from a transaction plan's catalog_entries", () => {
  const transactionPlan = {
    catalog_entries: [
      { catalog_ref: "acer_palmatum_species", slug: "acer-palmatum", display_name: "Acer palmatum" },
      { catalog_ref: "acer_palmatum_bloodgood", slug: "acer-palmatum-bloodgood" },
    ],
  };
  const map = buildCatalogSlugMap(transactionPlan);
  assert.equal(map.get("acer_palmatum_species"), "acer-palmatum");
  assert.equal(map.get("acer_palmatum_bloodgood"), "acer-palmatum-bloodgood");
  assert.equal(map.size, 2);
});

test("checkEditorialPlanAgainstDb: an existing editorial observation with the SAME value is a clean no-op, not a conflict", async () => {
  const input = validInput();
  const plan = buildEditorialPlan([input]);
  const { client } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", slug: "acer-palmatum" }],
    plant_trait_observations: [{ id: "obs-1", plant_catalog_id: "catalog-1", trait: "sun", provider: "editorial", raw_value: ["full_sun"] }],
    plant_trait_selections: [],
  });
  const checks = await checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef: new Map([["acer_palmatum_species", "acer-palmatum"]]) });
  const obsCheck = checks.find((c) => c.code === "OBSERVATION_ALREADY_EXISTS_SAME_VALUE");
  assert.ok(obsCheck);
  assert.equal(obsCheck.ok, true);
});

test("checkEditorialPlanAgainstDb: an existing editorial observation with a DIFFERENT value is a real conflict", async () => {
  const input = validInput();
  const plan = buildEditorialPlan([input]);
  const { client } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", slug: "acer-palmatum" }],
    plant_trait_observations: [{ id: "obs-1", plant_catalog_id: "catalog-1", trait: "sun", provider: "editorial", raw_value: ["partial_sun"] }],
    plant_trait_selections: [],
  });
  const checks = await checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef: new Map([["acer_palmatum_species", "acer-palmatum"]]) });
  const obsCheck = checks.find((c) => c.code === "OBSERVATION_CONFLICT");
  assert.ok(obsCheck);
  assert.equal(obsCheck.ok, false);
});
