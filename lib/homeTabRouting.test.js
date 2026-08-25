import { test } from "node:test";
import assert from "node:assert/strict";

import { tabFromQuery, tabToQuery, VALID_TABS } from "./homeTabRouting.js";

test("tabFromQuery: recognized tab values pass through", () => {
  assert.equal(tabFromQuery({ tab: "identifier" }), "identifier");
  assert.equal(tabFromQuery({ tab: "jardin" }), "jardin");
});

test("tabFromQuery: missing/empty query -> accueil (the pre-existing default)", () => {
  assert.equal(tabFromQuery({}), "accueil");
  assert.equal(tabFromQuery(undefined), "accueil");
});

test("tabFromQuery: an unrecognized or tampered value is never trusted -> accueil", () => {
  assert.equal(tabFromQuery({ tab: "admin" }), "accueil");
  assert.equal(tabFromQuery({ tab: "; DROP TABLE" }), "accueil");
});

test("tabFromQuery: a repeated query param (array) is never trusted -> accueil", () => {
  assert.equal(tabFromQuery({ tab: ["identifier", "jardin"] }), "accueil");
});

test("tabToQuery: accueil never appears in the URL", () => {
  assert.deepEqual(tabToQuery("accueil"), {});
});

test("tabToQuery: identifier/jardin round-trip through tabFromQuery", () => {
  for (const tab of VALID_TABS) {
    assert.deepEqual(tabToQuery(tab), { tab });
    assert.equal(tabFromQuery(tabToQuery(tab)), tab);
  }
});
