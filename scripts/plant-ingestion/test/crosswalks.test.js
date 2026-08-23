import { test } from "node:test";
import assert from "node:assert/strict";

import { convertToCm } from "../../plant-benchmark/src/normalize.js";
import { crosswalkSunValue, crosswalkSunArray, crosswalkRank, deriveProviderStatus } from "../src/crosswalks.js";

// Test #1: 20 feet -> 609.6 cm. Reuses the benchmark's own already-validated
// convertToCm rather than duplicating unit math — also guards against
// regressing the exact fact validated for Acer palmatum's Perenual height.
test("#1: 20 feet converts to 609.6 cm", () => {
  assert.equal(convertToCm(20, "feet"), 609.6);
});

// Test #2 / #3: the two Perenual sun values actually validated live.
test('#2: "full sun" crosswalks to full_sun', () => {
  assert.equal(crosswalkSunValue("full sun"), "full_sun");
});

test('#3: "part shade" crosswalks to partial_sun', () => {
  assert.equal(crosswalkSunValue("part shade"), "partial_sun");
});

// Test #4: an unrecognized provider value never gets a guessed canonical
// value — it is dropped with an explicit warning instead.
test("#4: unknown sunlight provider value produces a warning and no mapping", () => {
  assert.equal(crosswalkSunValue("dappled sun"), null);

  const { canonical, warnings } = crosswalkSunArray(["dappled sun"]);
  assert.equal(canonical, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unmapped provider value "dappled sun"/);
});

test("sun crosswalk: partial success keeps mapped values, warns only for unmapped ones", () => {
  const { canonical, warnings } = crosswalkSunArray(["full sun", "dappled sun"]);
  assert.deepEqual(canonical, ["full_sun"]);
  assert.equal(warnings.length, 1);
});

test("sun crosswalk: empty array is treated as no informative value (null, not [])", () => {
  const { canonical, warnings } = crosswalkSunArray([]);
  assert.equal(canonical, null);
  assert.deepEqual(warnings, []);
});

test("rank crosswalk: recognizes genus/species/subspecies/variety/form case-insensitively", () => {
  assert.equal(crosswalkRank("SPECIES"), "species");
  assert.equal(crosswalkRank("Genus"), "genus");
  assert.equal(crosswalkRank("subspecies"), "subspecies");
  assert.equal(crosswalkRank("VARIETY"), "variety");
  assert.equal(crosswalkRank("form"), "form");
});

test("rank crosswalk: unrecognized rank stays null, never guessed", () => {
  assert.equal(crosswalkRank("FAMILY"), null);
  assert.equal(crosswalkRank(""), null);
  assert.equal(crosswalkRank(null), null);
});

test("provider_status: a narrow-set status passes through unchanged, including unresolved_under_plan", () => {
  for (const s of ["ok", "not_found", "plan_restricted", "unresolved_under_plan", "provider_error", "skipped_no_key"]) {
    assert.equal(deriveProviderStatus(s), s);
  }
});

test("provider_status: unresolved_under_plan is never collapsed into not_found", () => {
  assert.equal(deriveProviderStatus("unresolved_under_plan"), "unresolved_under_plan");
  assert.notEqual(deriveProviderStatus("unresolved_under_plan"), "not_found");
});

test("provider_status: a matching-quality value (not in the narrow set) becomes ok", () => {
  for (const s of ["exact_scientific_match", "exact_cultivar_match", "ambiguous", "parent_taxon_match", "parent_only", "fuzzy_candidate"]) {
    assert.equal(deriveProviderStatus(s), "ok");
  }
});
