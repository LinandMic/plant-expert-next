// Investigates WHY a provider/WCVP cross-check (taxonomyMatch.js's
// classifyMatch, reused unmodified from the benchmark) can legitimately
// return "ambiguous" for an exact-cultivar horticultural match, and
// decides — from the exact mechanics involved, never by intuition —
// whether that specific "ambiguous" reflects real doubt about the
// record's identity or is a structural, fully-explainable side effect of
// WCVP simply not publishing cultivar epithets at all.
//
// ROOT CAUSE (documented, not guessed): WCVP/GBIF covers botanical
// nomenclature (ICN) — species, subspecies, variety, form. Cultivar
// epithets ("Bloodgood") are governed by the ICNCP, an entirely separate
// naming code, and are NEVER present in WCVP's accepted-name/synonym data.
// A horticultural provider's own `scientific_name` for a genuine cultivar
// record is confirmed (scripts/plant-benchmark/test/perenual.test.js, real
// validated shapes) to be formatted as `"<parent> '<Cultivar>'"` — e.g.
// "Hydrangea paniculata 'Bobo'", "Viburnum tinus 'Lisarose'". classifyMatch
// checks candidate === accepted_name / === a synonym / === the parent
// name exactly; a cultivar-suffixed candidate can NEVER equal any of those
// (it is neither the bare parent name nor absent a suffix), so it falls
// through to the same-genus "ambiguous" bucket — not because the record
// might be the wrong plant, but because WCVP has no data point capable of
// confirming OR denying a cultivar epithet either way. This is expected,
// structural behavior of classifyMatch given what WCVP actually publishes,
// not a defect in it.
//
// This module does not change classifyMatch or its output. It only adds a
// SEPARATE, narrow, structural check so the ingestion layer can tell that
// specific explainable case apart from a genuinely uncertain one (e.g. a
// same-genus but otherwise unrelated species) — used only to decide
// uncertain-flagging/selection-blocking, never to rewrite
// taxonomy_match_type itself.

function normalizeForComparison(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[’]/g, "'");
}

// isStructuralCultivarSuffixMatch — pure. True only when `candidateName`
// decomposes EXACTLY as `${acceptedName} '${cultivarName}'` — the
// documented, validated shape for a cultivar-suffixed provider name.
export function isStructuralCultivarSuffixMatch({ candidateName, acceptedName, cultivarName }) {
  if (!candidateName || !acceptedName || !cultivarName) return false;
  const expected = normalizeForComparison(`${acceptedName} '${cultivarName}'`);
  return normalizeForComparison(candidateName) === expected;
}

// Only these selection_reason values represent the PROVIDER's own
// confident, unambiguous match of exactly one candidate to the queried
// cultivar — the precondition the structural explanation is allowed to
// rely on. Anything looser (parent_taxon_match, ambiguous, fuzzy_candidate,
// parent_only) never gets the benefit of the doubt here.
const CONFIDENT_CULTIVAR_SELECTION_REASONS = new Set(["exact_cultivar_match"]);

// assessTaxonomyAmbiguity({ taxonomyMatchType, candidateName, acceptedName,
//   cultivarName, selectionReason, candidateCount }) -> {
//     applicable: boolean,   // false when taxonomy_match_type isn't "ambiguous" at all
//     resolved: boolean,     // true = structurally explained, not blocking
//     explanation: string,
//   }
export function assessTaxonomyAmbiguity({ taxonomyMatchType, candidateName, acceptedName, cultivarName, selectionReason, candidateCount }) {
  if (taxonomyMatchType !== "ambiguous") {
    return { applicable: false, resolved: true, explanation: null };
  }

  const structural = isStructuralCultivarSuffixMatch({ candidateName, acceptedName, cultivarName });
  const confidentSingleCandidate = CONFIDENT_CULTIVAR_SELECTION_REASONS.has(selectionReason) && candidateCount === 1;

  if (structural && confidentSingleCandidate) {
    return {
      applicable: true,
      resolved: true,
      explanation:
        `taxonomy_match_type=ambiguous is expected here, not a real doubt: WCVP does not publish cultivar ` +
        `epithets (ICNCP, not ICN), so it can never confirm "${candidateName}" against accepted name ` +
        `"${acceptedName}". The candidate decomposes exactly as "${acceptedName} '${cultivarName}'", the provider's ` +
        `own selection was ${selectionReason} with exactly 1 candidate — treated as non-blocking.`,
    };
  }

  return {
    applicable: true,
    resolved: false,
    explanation:
      `taxonomy_match_type=ambiguous for "${candidateName}" against accepted name "${acceptedName}" is NOT ` +
      `structurally explained (selection_reason=${selectionReason}, candidate_count=${candidateCount}) — treated ` +
      `as a real identification doubt: observations from this source are marked uncertain, no automatic selection ` +
      `is proposed from it until resolved.`,
  };
}
