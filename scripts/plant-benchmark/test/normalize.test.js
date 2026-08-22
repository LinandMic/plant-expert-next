import { test } from "node:test";
import assert from "node:assert/strict";
import { convertToCm } from "../src/normalize.js";

test("convertToCm: cm passthrough", () => {
  assert.equal(convertToCm(150, "cm"), 150);
});

test("convertToCm: meters -> cm (spec test #3)", () => {
  assert.equal(convertToCm(1.5, "m"), 150);
  assert.equal(convertToCm(2, "meters"), 200);
});

test("convertToCm: feet -> cm (spec test #2)", () => {
  assert.equal(convertToCm(1, "ft"), 30.48);
  assert.equal(convertToCm(2, "feet"), 60.96);
});

test("convertToCm: inches -> cm", () => {
  assert.equal(convertToCm(10, "in"), 25.4);
  assert.equal(convertToCm(10, "inches"), 25.4);
});

test("convertToCm: unknown unit -> null, never a guess (spec test #4)", () => {
  assert.equal(convertToCm(150, "furlong"), null);
  assert.equal(convertToCm(150, ""), null);
  assert.equal(convertToCm(150, null), null);
});

test("convertToCm: non-numeric value -> null, never 0", () => {
  assert.equal(convertToCm(null, "cm"), null);
  assert.equal(convertToCm(undefined, "cm"), null);
  assert.equal(convertToCm(NaN, "cm"), null);
  assert.equal(convertToCm("150", "cm"), null); // strings are never coerced silently here
});
