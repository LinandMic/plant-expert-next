import { test } from "node:test";
import assert from "node:assert/strict";

import { identifierHrefForName, MAX_PREFILL_NAME_LENGTH, nameFromQuery, tabFromQuery, tabToQuery, VALID_TABS } from "./homeTabRouting.js";
import { matchesKnownRoute, resolveInterceptedLinkPath } from "./nativeNavigation.js";

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

// --- Plant Finder "no result" -> Identifier with a pre-filled name ---------

test("identifierHrefForName: encodes the search text into ?tab=identifier&name=", () => {
  assert.equal(identifierHrefForName("Rosier"), "/?tab=identifier&name=Rosier");
  assert.equal(identifierHrefForName("  laurier cerise  "), "/?tab=identifier&name=laurier%20cerise");
  assert.equal(identifierHrefForName("Pélargonium & co"), "/?tab=identifier&name=P%C3%A9largonium%20%26%20co");
});

test("identifierHrefForName: empty/invalid name -> plain Identifier tab", () => {
  assert.equal(identifierHrefForName(""), "/?tab=identifier");
  assert.equal(identifierHrefForName("   "), "/?tab=identifier");
  assert.equal(identifierHrefForName(undefined), "/?tab=identifier");
});

test("nameFromQuery round-trips identifierHrefForName (as the router decodes it)", () => {
  for (const name of ["Rosier", "laurier cerise", "Pélargonium & co"]) {
    const url = new URL(identifierHrefForName(name), "https://app.almeo.app");
    const query = Object.fromEntries(url.searchParams);
    assert.equal(tabFromQuery(query), "identifier");
    assert.equal(nameFromQuery(query), name);
  }
});

test("nameFromQuery: missing, array or non-string values are never trusted; long values are capped", () => {
  assert.equal(nameFromQuery({}), "");
  assert.equal(nameFromQuery(undefined), "");
  assert.equal(nameFromQuery({ name: ["a", "b"] }), "");
  assert.equal(nameFromQuery({ name: "  Thym  " }), "Thym");
  assert.equal(nameFromQuery({ name: "x".repeat(500) }).length, MAX_PREFILL_NAME_LENGTH);
});

test("the Identifier link is a same-origin known route, so native routes it client-side", () => {
  const href = new URL(identifierHrefForName("Rosier"), "https://localhost").href;
  assert.equal(matchesKnownRoute("/", ["/", "/plant-finder"]), true);
  const path = resolveInterceptedLinkPath({
    event: { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
    anchor: { href, target: "", hasDownload: false },
    location: { origin: "https://localhost", pathname: "/plant-finder", search: "?q=Rosier" },
    knownRoutes: ["/", "/plant-finder", "/plant-finder/[slug]", "/profile"],
  });
  assert.equal(path, "/?tab=identifier&name=Rosier");
});
