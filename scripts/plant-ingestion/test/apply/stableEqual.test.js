import { test } from "node:test";
import assert from "node:assert/strict";

import { stableEqual } from "../../src/apply/stableEqual.js";

test("primitives: equal values are equal, different values are not", () => {
  assert.equal(stableEqual(1, 1), true);
  assert.equal(stableEqual("a", "a"), true);
  assert.equal(stableEqual(true, true), true);
  assert.equal(stableEqual(1, 2), false);
  assert.equal(stableEqual("a", "b"), false);
  assert.equal(stableEqual(true, false), false);
  assert.equal(stableEqual(0, false), false); // no cross-type coercion
});

test("null/undefined: treated identically (matching the ?? null convention used elsewhere)", () => {
  assert.equal(stableEqual(null, null), true);
  assert.equal(stableEqual(null, undefined), true);
  assert.equal(stableEqual(undefined, undefined), true);
  assert.equal(stableEqual(null, 0), false);
  assert.equal(stableEqual(null, ""), false);
});

// A/B. objects: key order ignored, including nested
test("A: objects with the same content in a different key order are equal", () => {
  assert.equal(stableEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});

test("B: nested objects with a different key order at every level are equal", () => {
  const x = { a: 1, nested: { p: true, q: null } };
  const y = { nested: { q: null, p: true }, a: 1 };
  assert.equal(stableEqual(x, y), true);
});

test("C: a genuinely different value anywhere in the object makes it different", () => {
  assert.equal(stableEqual({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  assert.equal(stableEqual({ a: 1, nested: { p: true } }, { a: 1, nested: { p: false } }), false);
});

test("a key present with null on one side and missing entirely on the other is treated as equal", () => {
  assert.equal(stableEqual({ a: 1, b: null }, { a: 1 }), true);
});

// D/E. arrays: order preserved
test("D: arrays with identical elements in the same order are equal", () => {
  assert.equal(stableEqual(["sun", "shade"], ["sun", "shade"]), true);
});

test("E: arrays with the same elements in a different order are NOT equal", () => {
  assert.equal(stableEqual(["sun", "shade"], ["shade", "sun"]), false);
});

test("an array is never equal to a plain object, even with matching-looking content", () => {
  assert.equal(stableEqual(["a", "b"], { 0: "a", 1: "b" }), false);
});

test("arrays of different length are not equal", () => {
  assert.equal(stableEqual(["a", "b"], ["a", "b", "c"]), false);
});

test("arrays containing objects: object order ignored, array order preserved", () => {
  assert.equal(stableEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]), true);
  assert.equal(stableEqual([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }]), false);
});

// Exact real-world regression cases found against production.
test("real case: Perenual metadata object with a different key order is equal", () => {
  const dbMetadata = { hybrid_field: null, variety_field: null, cultivar_field: null, subspecies_field: null };
  const planMetadata = { cultivar_field: null, variety_field: null, subspecies_field: null, hybrid_field: null };
  assert.equal(stableEqual(dbMetadata, planMetadata), true);
});

test("real case: the 'edible' trait raw_value object with a different key order is equal", () => {
  const dbRawValue = { edible_leaf: false, edible_fruit: false };
  const planRawValue = { edible_fruit: false, edible_leaf: false };
  assert.equal(stableEqual(dbRawValue, planRawValue), true);
});
