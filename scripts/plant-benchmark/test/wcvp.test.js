import { test } from "node:test";
import assert from "node:assert/strict";
import { usageFromRaw, buildTaxonomyView } from "../src/providers/wcvp.js";
import { selectCandidate } from "../src/candidateSelection.js";
import { classifyMatch, parseCultivarName } from "../src/taxonomyMatch.js";

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
