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

// All-or-nothing: a partially-mappable array must NEVER produce a partial
// canonical array — that would misrepresent the plant's real exposure
// profile (e.g. dropping an unmapped "part sun/part shade" would make it
// look like "full sun only"). It stays null (incomplete), with a precise
// warning for each unmapped value, until every informative raw value maps.
test("sun crosswalk: a fully mappable array normalizes completely, no warning", () => {
  const { canonical, warnings } = crosswalkSunArray(["full sun", "part shade"]);
  assert.deepEqual(canonical, ["full_sun", "partial_sun"]);
  assert.deepEqual(warnings, []);
});

test("sun crosswalk: a partially mappable array stays null (never partial), with a warning for the unmapped value", () => {
  const { canonical, warnings } = crosswalkSunArray(["full sun", "part sun/part shade"]);
  assert.equal(canonical, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unmapped provider value "part sun\/part shade"/);
});

test("sun crosswalk: an entirely unmappable array stays null, with a warning per unmapped value", () => {
  const { canonical, warnings } = crosswalkSunArray(["dappled sun", "part sun/part shade"]);
  assert.equal(canonical, null);
  assert.equal(warnings.length, 2);
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
