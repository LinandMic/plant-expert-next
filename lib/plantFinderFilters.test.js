import { test } from "node:test";
import assert from "node:assert/strict";

import {
  heightCategoryBounds,
  normalizePlantFinderFilters,
  parseFiltersFromQuery,
  serializeFiltersToQuery,
  formatResultCount,
  removeActiveFilter,
  resetFilters,
  clearAllFilters,
} from "./plantFinderFilters.js";

// A
test("A: a valid plant_type is accepted as-is (raw DB value, not the French label)", () => {
  assert.equal(normalizePlantFinderFilters({ plantType: "shrub" }).plantType, "shrub");
});

// B
test("B: an unknown plant_type is ignored, never forwarded raw", () => {
  assert.equal(normalizePlantFinderFilters({ plantType: "liana" }).plantType, null);
  assert.equal(normalizePlantFinderFilters({ plantType: "; DROP TABLE" }).plantType, null);
});

// C
test("C: a valid sun value is kept (whitelist)", () => {
  assert.deepEqual(normalizePlantFinderFilters({ sun: ["shade"] }).sun, ["shade"]);
});

// D
test("D: multiple valid sun values are all kept", () => {
  assert.deepEqual(normalizePlantFinderFilters({ sun: ["full_sun", "bright_shade"] }).sun, ["full_sun", "bright_shade"]);
});

// E
test("E: an unknown sun value is ignored, valid ones survive; all-unknown -> null", () => {
  assert.deepEqual(normalizePlantFinderFilters({ sun: ["full_sun", "midday_blast"] }).sun, ["full_sun"]);
  assert.equal(normalizePlantFinderFilters({ sun: ["midday_blast"] }).sun, null);
  assert.equal(normalizePlantFinderFilters({ sun: [] }).sun, null);
});

// F-I: height category bounds. Values are arbitrary boundary probes, never
// coupled to a real plant's actual height_max_cm.
test("F: height category 'small' -> no lower bound, <=100", () => {
  assert.deepEqual(heightCategoryBounds("small"), { min: null, max: 100 });
});

test("G: height category 'medium' -> >100 and <=300", () => {
  assert.deepEqual(heightCategoryBounds("medium"), { min: 100, max: 300 });
});

test("H: height category 'large' -> >300 and <=600", () => {
  assert.deepEqual(heightCategoryBounds("large"), { min: 300, max: 600 });
});

test("I: height category 'very_large' -> >600, no upper bound", () => {
  assert.deepEqual(heightCategoryBounds("very_large"), { min: 600, max: null });
});

// J
test("J: an unknown height category is ignored", () => {
  assert.equal(normalizePlantFinderFilters({ heightCategory: "gigantic" }).heightCategory, null);
  assert.equal(heightCategoryBounds("gigantic"), null);
});

// K
test("K: query text is trimmed", () => {
  assert.equal(normalizePlantFinderFilters({ query: "   erable japonais   " }).query, "erable japonais");
  assert.equal(normalizePlantFinderFilters({}).query, "");
});

// L
test("L: URL serialization — only active criteria appear, sun is comma-joined", () => {
  const query = serializeFiltersToQuery({
    query: "test",
    plantType: "tree",
    sun: ["full_sun", "partial_sun"],
    heightCategory: "large",
  });
  assert.deepEqual(query, { q: "test", type: "tree", sun: "full_sun,partial_sun", height: "large" });
});

test("L: URL serialization — an all-clear state produces an empty object", () => {
  assert.deepEqual(serializeFiltersToQuery({ query: "", plantType: null, sun: null, heightCategory: null }), {});
});

// M
test("M: URL parsing — valid params round-trip, comma-separated sun is split", () => {
  const filters = parseFiltersFromQuery({ q: "test", type: "shrub", sun: "shade,bright_shade", height: "medium" });
  assert.deepEqual(filters.sun, ["shade", "bright_shade"]);
  assert.equal(filters.plantType, "shrub");
  assert.equal(filters.heightCategory, "medium");
  assert.equal(filters.query, "test");
});

test("M: URL parsing — unknown values in the URL are dropped, not sent raw to Supabase", () => {
  const filters = parseFiltersFromQuery({ type: "not-a-real-type", sun: "shade,nonsense", height: "enormous" });
  assert.equal(filters.plantType, null);
  assert.deepEqual(filters.sun, ["shade"]);
  assert.equal(filters.heightCategory, null);
});

// N
test("N: result-count pluralization", () => {
  assert.equal(formatResultCount(1), "1 plante trouvée");
  assert.equal(formatResultCount(2), "2 plantes trouvées");
  assert.equal(formatResultCount(0), "0 plantes trouvées");
});

// O
test("O: removing one active filter leaves the others untouched", () => {
  const filters = { query: "test", plantType: "tree", sun: ["full_sun", "shade"], heightCategory: "large" };
  const next = removeActiveFilter(filters, "sun", "full_sun");
  assert.deepEqual(next.sun, ["shade"]);
  assert.equal(next.plantType, "tree");
  assert.equal(next.heightCategory, "large");
  assert.equal(next.query, "test");
});

test("O: removing the plantType or height chip clears only that criterion", () => {
  const filters = { query: "test", plantType: "tree", sun: ["full_sun"], heightCategory: "large" };
  assert.equal(removeActiveFilter(filters, "plantType", null).plantType, null);
  assert.deepEqual(removeActiveFilter(filters, "plantType", null).sun, ["full_sun"]);
  assert.equal(removeActiveFilter(filters, "height", null).heightCategory, null);
  assert.equal(removeActiveFilter(filters, "height", null).plantType, "tree");
});

// P
test("P: \"Réinitialiser les filtres\" clears type/sun/height but keeps the text search", () => {
  const filters = { query: "test", plantType: "tree", sun: ["full_sun"], heightCategory: "large" };
  const next = resetFilters(filters);
  assert.equal(next.query, "test");
  assert.equal(next.plantType, null);
  assert.equal(next.sun, null);
  assert.equal(next.heightCategory, null);
});

// Q
test("Q: \"Tout effacer\" clears the text search as well", () => {
  const next = clearAllFilters();
  assert.equal(next.query, "");
  assert.equal(next.plantType, null);
  assert.equal(next.sun, null);
  assert.equal(next.heightCategory, null);
});
