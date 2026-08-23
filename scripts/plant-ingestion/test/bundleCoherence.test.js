import { test } from "node:test";
import assert from "node:assert/strict";

import { mapPerenualDetailToTraits } from "../../plant-benchmark/src/providers/perenual.js";
import { mapTrefleDetailToTraits } from "../../plant-benchmark/src/providers/trefle.js";
import { buildSourceRecord, buildObservations } from "../src/provenance.js";
import { applyDeterministicNormalizations } from "../src/normalization.js";
import { proposeSelections } from "../src/selections.js";
import { isInformative } from "../src/informative.js";

const WCVP_TAXONOMY = { accepted_name: "Acer palmatum", canonical_name: "Acer palmatum", synonyms: [], taxonomic_status: "ACCEPTED" };

// Mirrors bundle.js's own ambiguity-handling glue exactly (already unit
// tested in taxonomyAmbiguity.test.js / provenance.test.js) — reproduced
// minimally here since this test builds plant entries without a network
// call, so it cannot go through bundle.js's buildPlantEntry directly.
function applyAmbiguity(sourceRecord, observations, warnings) {
  const a = sourceRecord.taxonomy_ambiguity;
  if (!a.applicable) return observations;
  warnings.push(a.explanation);
  return a.resolved ? observations : observations.map((o) => ({ ...o, uncertain: true }));
}

function buildFixturePlant({ catalogRef, perenualDetail, perenualRecord, perenualSelectionReason, perenualCandidateCount, trefleDetail, trefleStatus, cultivarName }) {
  const warnings = [];
  const retrievedAt = "2026-08-23T00:00:00.000Z";

  const perenualResult = perenualDetail
    ? { status: "ok", selection_reason: perenualSelectionReason, candidate_count: perenualCandidateCount, record: { ...perenualRecord, source_url: "https://perenual.com/x" }, traits: mapPerenualDetailToTraits({ candidateId: perenualRecord.id, sourceUrl: "https://perenual.com/x", detailData: perenualDetail, retrievedAt }).traits }
    : { status: "not_found", selection_reason: "not_found", record: null, traits: {} };

  const trefleResult = trefleStatus === "ok"
    ? { status: "ok", selection_reason: "exact_scientific_match", candidate_count: 1, record: { id: 1, source_url: "https://trefle.io/x" }, traits: mapTrefleDetailToTraits({ candidateId: 1, sourceUrl: "https://trefle.io/x", detailData: trefleDetail, retrievedAt }).traits }
    : { status: "not_found", selection_reason: "not_found", record: null, traits: {} };

  const perenualSr = buildSourceRecord({ provider: "perenual", catalogRef, result: perenualResult, wcvpTaxonomy: WCVP_TAXONOMY, retrievedAt, cultivarName });
  const trefleSr = buildSourceRecord({ provider: "trefle", catalogRef, result: trefleResult, wcvpTaxonomy: WCVP_TAXONOMY, retrievedAt, cultivarName });

  const perenualObs = buildObservations({ provider: "perenual", catalogRef, sourceRecordRef: perenualSr.source_record_ref, result: perenualResult });
  const trefleObs = buildObservations({ provider: "trefle", catalogRef, sourceRecordRef: trefleSr.source_record_ref, result: trefleResult });

  const adjusted = [...applyAmbiguity(perenualSr, perenualObs, warnings), ...applyAmbiguity(trefleSr, trefleObs, warnings)];
  const { observations, warnings: normWarnings } = applyDeterministicNormalizations(adjusted);
  warnings.push(...normWarnings);

  const { selections, warnings: selWarnings } = proposeSelections({ observations });
  warnings.push(...selWarnings);

  return { source_records: [perenualSr.source_record, trefleSr.source_record], trait_observations: observations, trait_selections: selections, warnings };
}

const ACER_SPECIES = buildFixturePlant({
  catalogRef: "acer_palmatum_species",
  perenualDetail: { type: "tree", sunlight: ["Full sun", "part shade"], dimensions: [{ type: "Height", min_value: 20, max_value: 20, unit: "feet" }], hardiness: { min: 6, max: 6 }, attracts: [], soil: [] },
  perenualRecord: { id: 27, provider_name: "Japanese Maple", scientific_name: "Acer palmatum" },
  perenualSelectionReason: "exact_scientific_match",
  perenualCandidateCount: 1,
  trefleDetail: { growth: { light: 7, ph_minimum: 6.5, ph_maximum: 7 } },
  trefleStatus: "ok",
  cultivarName: null,
});

const BLOODGOOD = buildFixturePlant({
  catalogRef: "acer_palmatum_bloodgood",
  perenualDetail: { type: "tree", dimensions: [{ type: "Height", min_value: 20, max_value: 20, unit: "feet" }], soil: [] },
  perenualRecord: { id: 43, provider_name: "Bloodgood Japanese Maple", scientific_name: "Acer palmatum 'Bloodgood'" },
  perenualSelectionReason: "exact_cultivar_match",
  perenualCandidateCount: 1,
  trefleDetail: null,
  trefleStatus: "not_found",
  cultivarName: "Bloodgood",
});

const ALL_PLANTS = [ACER_SPECIES, BLOODGOOD];

// A. No observation has a non-informative raw_value/normalized_value,
// EXCEPT normalized_value=null when a canonical normalization is
// explicitly impossible but raw_value stays informative (e.g. sun with an
// incomplete crosswalk — not the case in this fixture, but the rule must
// hold regardless).
test("A: no observation carries a non-informative raw_value; normalized_value=null only ever paired with an informative raw_value", () => {
  for (const plant of ALL_PLANTS) {
    for (const obs of plant.trait_observations) {
      assert.ok(isInformative(obs.raw_value), `${obs.trait}: raw_value must be informative, got ${JSON.stringify(obs.raw_value)}`);
      if (obs.normalized_value === null) {
        assert.ok(isInformative(obs.raw_value), `${obs.trait}: normalized_value=null must still have an informative raw_value`);
      }
    }
    // The exact real bug: attracts=[]/soil=[] must never survive as observations.
    assert.ok(!plant.trait_observations.some((o) => o.trait === "attracts" || o.trait === "soil"));
  }
});

// B. Every selection points to an existing observation.
test("B: every selection references an observation that actually exists", () => {
  for (const plant of ALL_PLANTS) {
    const knownRefs = new Set(plant.trait_observations.map((o) => o.observation_ref));
    for (const selection of plant.trait_selections) {
      assert.ok(knownRefs.has(selection.observation_ref), `${plant === ACER_SPECIES ? "Acer" : "Bloodgood"}: selection ${selection.trait} -> unknown ref ${selection.observation_ref}`);
    }
  }
});

// C. Every selection.normalized_value === observation.normalized_value.
test("C: every selection.normalized_value is deeply equal to its observation's normalized_value", () => {
  for (const plant of ALL_PLANTS) {
    const byRef = Object.fromEntries(plant.trait_observations.map((o) => [o.observation_ref, o]));
    for (const selection of plant.trait_selections) {
      assert.deepEqual(selection.normalized_value, byRef[selection.observation_ref].normalized_value);
    }
  }
});

// D. No sun selection when the crosswalk is incomplete — Acer's sun here
// IS fully mappable, so a sun selection IS expected; this specifically
// re-asserts the rule holds for the actually-produced result.
test("D: sun selection only exists when every informative raw sun value mapped", () => {
  const acerSun = ACER_SPECIES.trait_selections.find((s) => s.trait === "sun");
  assert.ok(acerSun);
  assert.deepEqual(acerSun.normalized_value, ["full_sun", "partial_sun"]);
  // Bloodgood's fixture has no sun data at all -> no sun selection.
  assert.ok(!BLOODGOOD.trait_selections.some((s) => s.trait === "sun"));
});

// E. provider_error/not_found never generates a fictitious observation —
// Bloodgood's Trefle call is not_found here.
test("E: Trefle not_found for Bloodgood produced zero Trefle observations", () => {
  assert.ok(!BLOODGOOD.trait_observations.some((o) => o.provider === "trefle"));
  const trefleSr = BLOODGOOD.source_records.find((s) => s.provider === "trefle");
  assert.equal(trefleSr.provider_status, "not_found");
});

test("Bloodgood's structurally-resolved taxonomy ambiguity does not block its selections", () => {
  assert.ok(BLOODGOOD.trait_selections.some((s) => s.trait === "height_max_cm"));
  assert.ok(BLOODGOOD.warnings.some((w) => w.includes("ICNCP")));
});
