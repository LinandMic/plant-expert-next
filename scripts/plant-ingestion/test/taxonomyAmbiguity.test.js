import { test } from "node:test";
import assert from "node:assert/strict";

import { isStructuralCultivarSuffixMatch, assessTaxonomyAmbiguity } from "../src/taxonomyAmbiguity.js";
import { buildSourceRecord } from "../src/provenance.js";

test("isStructuralCultivarSuffixMatch: recognizes the validated Perenual cultivar-name shape", () => {
  assert.equal(isStructuralCultivarSuffixMatch({ candidateName: "Acer palmatum 'Bloodgood'", acceptedName: "Acer palmatum", cultivarName: "Bloodgood" }), true);
});

test("isStructuralCultivarSuffixMatch: case-insensitive, whitespace-tolerant", () => {
  assert.equal(isStructuralCultivarSuffixMatch({ candidateName: "acer  palmatum 'bloodgood'", acceptedName: "Acer palmatum", cultivarName: "Bloodgood" }), true);
});

test("isStructuralCultivarSuffixMatch: false for an unrelated candidate", () => {
  assert.equal(isStructuralCultivarSuffixMatch({ candidateName: "Acer rubrum", acceptedName: "Acer palmatum", cultivarName: "Bloodgood" }), false);
});

test("isStructuralCultivarSuffixMatch: false for a different cultivar epithet", () => {
  assert.equal(isStructuralCultivarSuffixMatch({ candidateName: "Acer palmatum 'Atropurpureum'", acceptedName: "Acer palmatum", cultivarName: "Bloodgood" }), false);
});

test("assessTaxonomyAmbiguity: not applicable when taxonomy_match_type isn't ambiguous", () => {
  const result = assessTaxonomyAmbiguity({ taxonomyMatchType: "exact_accepted_match", candidateName: "x", acceptedName: "x", cultivarName: null, selectionReason: "exact_scientific_match", candidateCount: 1 });
  assert.equal(result.applicable, false);
  assert.equal(result.resolved, true);
});

// The exact real Bloodgood case: candidate_count=1, selection_reason=
// exact_cultivar_match, candidate = "Acer palmatum 'Bloodgood'" — resolved,
// non-blocking, per the exact rules documented in taxonomyAmbiguity.js.
test("assessTaxonomyAmbiguity: structurally resolved for the real Bloodgood case (candidate_count=1, exact_cultivar_match)", () => {
  const result = assessTaxonomyAmbiguity({
    taxonomyMatchType: "ambiguous",
    candidateName: "Acer palmatum 'Bloodgood'",
    acceptedName: "Acer palmatum",
    cultivarName: "Bloodgood",
    selectionReason: "exact_cultivar_match",
    candidateCount: 1,
  });
  assert.equal(result.applicable, true);
  assert.equal(result.resolved, true);
  assert.match(result.explanation, /ICNCP/);
});

test("assessTaxonomyAmbiguity: NOT resolved when candidate_count > 1, even with exact_cultivar_match and a structural match", () => {
  const result = assessTaxonomyAmbiguity({
    taxonomyMatchType: "ambiguous",
    candidateName: "Acer palmatum 'Bloodgood'",
    acceptedName: "Acer palmatum",
    cultivarName: "Bloodgood",
    selectionReason: "exact_cultivar_match",
    candidateCount: 2,
  });
  assert.equal(result.resolved, false);
});

test("assessTaxonomyAmbiguity: NOT resolved when selection_reason is only parent_taxon_match", () => {
  const result = assessTaxonomyAmbiguity({
    taxonomyMatchType: "ambiguous",
    candidateName: "Acer palmatum",
    acceptedName: "Acer palmatum",
    cultivarName: "Bloodgood",
    selectionReason: "parent_taxon_match",
    candidateCount: 1,
  });
  assert.equal(result.resolved, false);
});

test("assessTaxonomyAmbiguity: NOT resolved when the candidate name doesn't structurally decompose as expected", () => {
  const result = assessTaxonomyAmbiguity({
    taxonomyMatchType: "ambiguous",
    candidateName: "Acer palmatum var. atropurpureum",
    acceptedName: "Acer palmatum",
    cultivarName: "Bloodgood",
    selectionReason: "exact_cultivar_match",
    candidateCount: 1,
  });
  assert.equal(result.resolved, false);
});

// Integration: buildSourceRecord wires this through end-to-end without
// ever rewriting taxonomy_match_type itself.
test("buildSourceRecord: taxonomy_match_type stays exactly 'ambiguous', never rewritten, even when structurally resolved", () => {
  const { source_record, taxonomy_ambiguity } = buildSourceRecord({
    provider: "perenual",
    catalogRef: "acer_palmatum_bloodgood",
    result: {
      status: "ok",
      selection_reason: "exact_cultivar_match",
      candidate_count: 1,
      record: { id: 43, provider_name: "Bloodgood Japanese Maple", scientific_name: "Acer palmatum 'Bloodgood'" },
    },
    wcvpTaxonomy: { accepted_name: "Acer palmatum", canonical_name: "Acer palmatum", synonyms: [], taxonomic_status: "ACCEPTED" },
    cultivarName: "Bloodgood",
    retrievedAt: "2026-08-23T00:00:00.000Z",
  });

  assert.equal(source_record.taxonomy_match_type, "ambiguous");
  assert.equal(taxonomy_ambiguity.applicable, true);
  assert.equal(taxonomy_ambiguity.resolved, true);
});
