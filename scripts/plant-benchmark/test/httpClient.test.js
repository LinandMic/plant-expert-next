import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlanRestrictedBody } from "../src/httpClient.js";

test("isPlanRestrictedBody: real observed Perenual upgrade-plan body -> true", () => {
  const body = "Please Upgrade Plan – https://www.perenual.com/subscription-api-pricing. Sorry";
  assert.equal(isPlanRestrictedBody(body), true);
});

test("isPlanRestrictedBody: a generic 429 with no upgrade-plan wording is NEVER auto-classified as plan_restricted", () => {
  assert.equal(isPlanRestrictedBody("Too Many Requests"), false);
  assert.equal(isPlanRestrictedBody("Rate limit exceeded, please try again later."), false);
  assert.equal(isPlanRestrictedBody("{\"error\":\"rate limited\"}"), false);
});

test("isPlanRestrictedBody: empty/missing body -> false, never a guess", () => {
  assert.equal(isPlanRestrictedBody(null), false);
  assert.equal(isPlanRestrictedBody(undefined), false);
  assert.equal(isPlanRestrictedBody(""), false);
});

test("isPlanRestrictedBody: case-insensitive, and matches on the pricing-URL marker alone", () => {
  assert.equal(isPlanRestrictedBody("please upgrade plan to continue"), true);
  assert.equal(isPlanRestrictedBody("See https://www.perenual.com/subscription-api-pricing for details"), true);
});
