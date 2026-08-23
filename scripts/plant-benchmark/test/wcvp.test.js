import { test } from "node:test";
import assert from "node:assert/strict";
import { usageFromRaw, buildTaxonomyView, scoreWcvpResults, shouldFallbackToFullTextSearch } from "../src/providers/wcvp.js";
import { selectCandidate } from "../src/candidateSelection.js";
import { classifyMatch, parseCultivarName } from "../src/taxonomyMatch.js";

// Real GBIF exact-lookup fixture, verified live:
// GET https://api.gbif.org/v1/species?datasetKey=<WCVP>&name=Rosmarinus%20officinalis
// -> HTTP 200, 1 result, a SYNONYM with an acceptedKey. These are public
// GBIF/WCVP taxon identifiers, not secrets.
const REAL_ROSMARINUS_SYNONYM_FIXTURE = {
  key: 207219419,
  canonicalName: "Rosmarinus officinalis",
  scientificName: "Rosmarinus officinalis L.",
  taxonomicStatus: "SYNONYM",
  acceptedKey: 207219357,
  rank: "SPECIES",
};

test("wcvp #13: accepted usage resolved directly when the queried record is already ACCEPTED", () => {
  const raw = {
    key: 111,
    canonicalName: "Hydrangea paniculata",
    taxonomicStatus: "ACCEPTED",
    rank: "SPECIES",
    family: "Hydrangeaceae",
    genus: "Hydrangea",
    species: "Hydrangea paniculata",
  };
  const queriedUsage = usageFromRaw(raw);
  // No synonym involved — accepted_usage IS the queried usage, per wcvp.js's
  // own logic (queryWcvp sets acceptedUsage = queriedUsage when !isSynonym).
  const view = buildTaxonomyView({ queriedUsage, acceptedUsage: queriedUsage, synonyms: [] });
  assert.equal(view.accepted_name, "Hydrangea paniculata");
  assert.equal(view.taxonomic_status, "ACCEPTED");
  assert.equal(view.source_taxon_id, "111");
  assert.equal(view.accepted_taxon_id, "111");
});

test("wcvp #14: a SYNONYM queried usage is never presented as the accepted usage — queried_usage stays distinct", () => {
  const queriedRaw = {
    key: 222,
    canonicalName: "Hydrangea paniculata var. old",
    taxonomicStatus: "SYNONYM",
    rank: "VARIETY",
    acceptedKey: 333,
  };
  const acceptedRaw = {
    key: 333,
    canonicalName: "Hydrangea paniculata",
    taxonomicStatus: "ACCEPTED",
    rank: "SPECIES",
    family: "Hydrangeaceae",
    genus: "Hydrangea",
    species: "Hydrangea paniculata",
  };
  const queriedUsage = usageFromRaw(queriedRaw);
  const acceptedUsage = usageFromRaw(acceptedRaw);

  assert.equal(queriedUsage.taxonomic_status, "SYNONYM");
  assert.equal(queriedUsage.canonical_name, "Hydrangea paniculata var. old");

  const view = buildTaxonomyView({ queriedUsage, acceptedUsage, synonyms: ["Hydrangea paniculata var. old"] });
  // The flattened view exposed downstream must reflect the ACCEPTED record,
  // never the synonym that was actually matched by the search.
  assert.equal(view.accepted_name, "Hydrangea paniculata");
  assert.equal(view.taxonomic_status, "ACCEPTED");
  assert.equal(view.source_taxon_id, "222");
  assert.equal(view.accepted_taxon_id, "333");
  assert.ok(view.synonyms.includes("Hydrangea paniculata var. old"));
});

test("wcvp #15: no reliable match among multiple candidates -> ambiguous, never a silent results[0] pick", () => {
  const candidates = [
    { id: 1, rawName: "Hydrangea serrata" },
    { id: 2, rawName: "Hydrangea sargentiana" },
  ];
  const { selected, selection_reason } = selectCandidate({
    parentName: "Hydrangea something",
    cultivarName: null,
    candidates,
  });
  // Neither candidate matches the query name; both fall back to the same
  // low fuzzy score, which must resolve to ambiguous rather than picking
  // whichever happened to come first in the list.
  assert.equal(selection_reason, "ambiguous");
  assert.ok(selected);
});

test("wcvp #15b: zero candidates -> not_found, never a false match", () => {
  const { selected, selection_reason } = selectCandidate({
    parentName: "Nonexistens fabricata",
    cultivarName: null,
    candidates: [],
  });
  assert.equal(selected, null);
  assert.equal(selection_reason, "not_found");
});

test("wcvp #16: a cultivar is never treated as an independent WCVP taxon — always split into parent + cultivar", () => {
  const { parentName, cultivarName } = parseCultivarName("Hydrangea paniculata 'Bobo'");
  assert.equal(parentName, "Hydrangea paniculata");
  assert.equal(cultivarName, "Bobo");

  // WCVP is queried on the parent only (spec §18) — a provider's own
  // scientific name for that cultivar is then cross-checked against WCVP's
  // taxonomy for the PARENT, classified as parent_taxon_match, never as if
  // WCVP itself resolved a cultivar-level taxon.
  const wcvpTaxonomy = {
    accepted_name: "Hydrangea paniculata",
    canonical_name: "Hydrangea paniculata",
    taxonomic_status: "ACCEPTED",
    synonyms: [],
  };
  const result = classifyMatch({
    providerName: "Hydrangea paniculata",
    wcvpTaxonomy,
    cultivarParentName: parentName,
  });
  assert.equal(result, "exact_accepted_match");

  const cultivarLevelResult = classifyMatch({
    providerName: "Hydrangea paniculata 'Bobo'",
    wcvpTaxonomy,
    cultivarParentName: parentName,
  });
  // The cultivar-qualified name does not equal WCVP's accepted/canonical
  // parent name string, and is not in the parent's synonym list either —
  // it must never be reported as an exact match against a taxon WCVP never
  // actually resolved.
  assert.notEqual(cultivarLevelResult, "exact_accepted_match");
});

// --- Corrections after real-API testing: exact lookup is now primary ----

test("wcvp: real Rosmarinus officinalis exact-lookup fixture scores as a confident (non-ambiguous) exact match", () => {
  const selection = scoreWcvpResults([REAL_ROSMARINUS_SYNONYM_FIXTURE], "Rosmarinus officinalis");
  assert.ok(selection.selected);
  assert.equal(selection.selected.id, 207219419);
  assert.equal(selection.selection_reason, "exact_scientific_match");
  assert.notEqual(selection.selection_reason, "ambiguous");
});

test("wcvp: real Rosmarinus officinalis fixture is recognized as SYNONYM with a followable acceptedKey", () => {
  const queriedUsage = usageFromRaw(REAL_ROSMARINUS_SYNONYM_FIXTURE);
  assert.equal(queriedUsage.taxonomic_status, "SYNONYM");
  assert.equal(queriedUsage.taxon_id, "207219419");
  assert.equal(REAL_ROSMARINUS_SYNONYM_FIXTURE.acceptedKey, 207219357);

  // queried_usage and accepted_usage stay distinct objects even once the
  // accepted record is resolved (fabricated here as the accepted fixture
  // would look, mirroring what a second GBIF call would return).
  const acceptedUsage = usageFromRaw({
    key: 207219357,
    canonicalName: "Rosmarinus officinalis",
    taxonomicStatus: "ACCEPTED",
    rank: "SPECIES",
    family: "Lamiaceae",
    genus: "Rosmarinus",
    species: "Rosmarinus officinalis",
  });
  assert.notEqual(queriedUsage.taxon_id, acceptedUsage.taxon_id);
  const view = buildTaxonomyView({ queriedUsage, acceptedUsage, synonyms: [] });
  assert.equal(view.taxonomic_status, "ACCEPTED");
  assert.equal(view.source_taxon_id, "207219419");
  assert.equal(view.accepted_taxon_id, "207219357");
});

test("wcvp: shouldFallbackToFullTextSearch -> true when exact lookup returns zero results", () => {
  assert.equal(shouldFallbackToFullTextSearch([], { selection_reason: "not_found" }), true);
});

test("wcvp: shouldFallbackToFullTextSearch -> true when exact lookup itself is ambiguous", () => {
  const selection = scoreWcvpResults(
    [
      { key: 1, canonicalName: "Foo bar", taxonomicStatus: "ACCEPTED" },
      { key: 2, canonicalName: "Foo baz", taxonomicStatus: "ACCEPTED" },
    ],
    "Foo something"
  );
  assert.equal(shouldFallbackToFullTextSearch([{}, {}], selection), true);
});

test("wcvp: shouldFallbackToFullTextSearch -> false when the exact lookup already produced a confident match (no redundant full-text call)", () => {
  const selection = scoreWcvpResults([REAL_ROSMARINUS_SYNONYM_FIXTURE], "Rosmarinus officinalis");
  assert.equal(shouldFallbackToFullTextSearch([REAL_ROSMARINUS_SYNONYM_FIXTURE], selection), false);
});
