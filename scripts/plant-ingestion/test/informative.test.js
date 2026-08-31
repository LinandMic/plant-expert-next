import { test } from "node:test";
import assert from "node:assert/strict";

import { isInformative, orNull } from "../src/informative.js";

// Test #5: false is a real, informative value — never treated as "unknown".
test("#5: false is informative", () => {
  assert.equal(isInformative(false), true);
  assert.equal(orNull(false), false);
});

// Test #6: 0 is a real, informative value — never treated as "unknown".
test("#6: 0 is informative", () => {
  assert.equal(isInformative(0), true);
  assert.equal(orNull(0), 0);
});

// Test #7: [] carries no information — must never stand in for "unknown"
// as if it were a known empty value.
test("#7: [] is non-informative", () => {
  assert.equal(isInformative([]), false);
  assert.equal(orNull([]), null);
});

// Test #8: null carries no information.
test("#8: null is non-informative", () => {
  assert.equal(isInformative(null), false);
  assert.equal(isInformative(undefined), false);
  assert.equal(orNull(null), null);
});

test("empty string is treated the same as unknown, never a known empty value", () => {
  assert.equal(isInformative(""), false);
  assert.equal(orNull(""), null);
});

test("a non-empty array/string/true are informative", () => {
  assert.equal(isInformative([1]), true);
  assert.equal(isInformative("x"), true);
  assert.equal(isInformative(true), true);
});
