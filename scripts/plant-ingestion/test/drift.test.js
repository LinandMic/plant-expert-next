import { test } from "node:test";
import assert from "node:assert/strict";

import { checkAcerSpeciesDrift, checkBloodgoodDrift } from "../src/drift.js";
import { ACER_PALMATUM_BASELINE, BLOODGOOD_BASELINE } from "../src/baseline.js";

function sr(provider, overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", provider, provider_status: "ok", selection_reason: "exact_scientific_match", ...overrides };
}

function obsFixture(provider, trait, normalized_value) {
  return { observation_ref: `x:${provider}:${trait}`, catalog_ref: "acer_palmatum_species", provider, trait, normalized_value, raw_value: normalized_value };
}

// Test A: baseline never creates an observation when live has no data —
// the drift check is read-only and returns warnings only; it must never
// add to the observations array, and when live genuinely has nothing for
// a trait (no observation object at all), no warning is fabricated either.
test("A: baseline never creates an observation when live API has no data for that field", () => {
  const observations = []; // live returned nothing at all
  const frozenObservations = Object.freeze(observations.slice());
  const sourceRecords = [sr("perenual"), sr("trefle")];

  const warnings = checkAcerSpeciesDrift({ sourceRecords, observations: frozenObservations });

  // The array itself was never mutated (freeze would throw on mutation).
  assert.deepEqual(frozenObservations, []);
  // No live height observation exists, so nothing to compare — no warning
  // fabricated purely from the baseline's own existence.
  assert.deepEqual(warnings, []);
});

// Test B: a live Acer height that differs from the baseline produces a
// warning but the live value is what remains in the observation (the
// drift check never rewrites it — it only reads observations, passed here
// by reference, and returns warnings separately).
test("B: differing live Acer Perenual height produces a warning, live value untouched", () => {
  const observations = [obsFixture("perenual", "height_max_cm", 500), obsFixture("perenual", "height_min_cm", 500)];
  const sourceRecords = [sr("perenual")];

  const warnings = checkAcerSpeciesDrift({ sourceRecords, observations });

  assert.equal(observations[0].normalized_value, 500); // untouched
  assert.ok(warnings.some((w) => w.includes("perenual") && w.includes("height_max_cm") && w.includes("609.6") && w.includes("500")));
});

test("B bis: a live Acer height matching the baseline produces no warning", () => {
  const observations = [obsFixture("perenual", "height_max_cm", 609.6), obsFixture("perenual", "height_min_cm", 609.6)];
  const sourceRecords = [sr("perenual")];
  const warnings = checkAcerSpeciesDrift({ sourceRecords, observations });
  assert.deepEqual(warnings, []);
});

// Test C: Trefle now returning a usable Acer height (baseline had none)
// produces a warning, and the live observation is what's kept (the drift
// check doesn't touch it).
test("C: new usable Trefle Acer height (baseline had none) produces a warning, live observation kept", () => {
  const observations = [obsFixture("trefle", "height_max_cm", 350)];
  const sourceRecords = [sr("trefle")];

  const warnings = checkAcerSpeciesDrift({ sourceRecords, observations });

  assert.equal(observations[0].normalized_value, 350);
  assert.ok(warnings.some((w) => w.includes("trefle") && w.includes("height_max_cm") && w.includes("350")));
});

// Test D: Trefle Bloodgood now matches something, where the baseline was
// not_found -> warning.
test("D: Trefle Bloodgood live match after previous not_found produces a warning", () => {
  const sourceRecords = [sr("trefle", { provider_status: "ok", selection_reason: "exact_cultivar_match" })];
  const warnings = checkBloodgoodDrift({ sourceRecords });
  assert.ok(warnings.some((w) => w.includes("trefle") && w.includes("provider_status") && w.includes("not_found") && w.includes("ok")));
});

test("D bis: Trefle Bloodgood still not_found produces no drift warning", () => {
  const sourceRecords = [sr("trefle", { provider_status: "not_found", selection_reason: "not_found" })];
  const warnings = checkBloodgoodDrift({ sourceRecords });
  assert.deepEqual(warnings, []);
});

// Test E: Perenual Bloodgood no longer exact_cultivar_match -> warning.
test("E: Perenual Bloodgood non-exact match after previous exact_cultivar_match produces a warning", () => {
  const sourceRecords = [sr("perenual", { provider_status: "ok", selection_reason: "parent_taxon_match" })];
  const warnings = checkBloodgoodDrift({ sourceRecords });
  assert.ok(warnings.some((w) => w.includes("perenual") && w.includes("selection_reason") && w.includes("exact_cultivar_match") && w.includes("parent_taxon_match")));
});

// Test F: provider_error never receives a historical fallback value —
// no comparison happens at all, so no warning references the baseline as
// if it were live data, and (separately, already guaranteed by
// provenance.js) no observation is fabricated for a failed call.
test("F: provider_error produces no drift warning and no baseline fallback", () => {
  const acerWarnings = checkAcerSpeciesDrift({
    sourceRecords: [sr("perenual", { provider_status: "provider_error", selection_reason: null }), sr("trefle", { provider_status: "provider_error", selection_reason: null })],
    observations: [],
  });
  assert.deepEqual(acerWarnings, []);

  const bloodgoodWarnings = checkBloodgoodDrift({
    sourceRecords: [sr("perenual", { provider_status: "provider_error", selection_reason: null }), sr("trefle", { provider_status: "provider_error", selection_reason: null })],
  });
  assert.deepEqual(bloodgoodWarnings, []);
});

test("F bis: skipped_no_key (missing API key) also produces no drift warning", () => {
  const acerWarnings = checkAcerSpeciesDrift({
    sourceRecords: [sr("perenual", { provider_status: "skipped_no_key", selection_reason: "skipped_no_key" }), sr("trefle", { provider_status: "skipped_no_key", selection_reason: "skipped_no_key" })],
    observations: [],
  });
  assert.deepEqual(acerWarnings, []);
});

test("baseline module exposes the exact previously-validated facts, used only as a comparison target", () => {
  assert.equal(ACER_PALMATUM_BASELINE.perenual.height_max_cm, 609.6);
  assert.equal(ACER_PALMATUM_BASELINE.trefle.light_0_10, 7);
  assert.equal(BLOODGOOD_BASELINE.perenual.selection_reason, "exact_cultivar_match");
  assert.equal(BLOODGOOD_BASELINE.trefle.provider_status, "not_found");
});
