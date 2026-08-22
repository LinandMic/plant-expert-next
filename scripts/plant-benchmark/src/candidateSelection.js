// Shared, deterministic candidate-selection logic used by every provider
// (WCVP/GBIF, Perenual, Trefle) that returns a list of search results and
// needs to pick one — never `candidates[0]` silently. No IA, no fuzzy
// matching library: a small set of documented, reproducible string rules.
//
// normalizeComparisonName() is used ONLY to compare names — the caller must
// always keep the original, un-normalized name (`raw_name`) alongside it;
// this module never mutates or discards the original botanical name.

const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;

export function normalizeComparisonName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * selectCandidate({ parentName, cultivarName, candidates })
 *
 * candidates: [{ id, rawName, ...anything else the caller wants kept }]
 * parentName: the botanical parent name being searched for (always what is
 *   actually queried — a cultivar epithet is never sent to a taxonomy
 *   source, see taxonomyMatch.parseCultivarName).
 * cultivarName: the cultivar epithet if this was a cultivar query, else null.
 *
 * Returns { selected, selection_reason, candidates } where `candidates` is
 * every input candidate annotated with its own normalized_comparison_name,
 * score, and reason — kept in full (or capped by the caller for display)
 * so a human can audit *why* a given record was chosen (spec §14).
 *
 * Species-query priority (spec §12):
 *   scientific_name exact > parent/infraspecific compatible > fuzzy
 * Cultivar-query priority (spec §12):
 *   cultivar exact > parent species only > fuzzy
 *
 * Ties at a non-exact score, or zero candidates, never produce a silent
 * guess — they resolve to "ambiguous"/"not_found" respectively (spec §17).
 */
export function selectCandidate({ parentName, cultivarName, candidates }) {
  const isCultivarQuery = Boolean(cultivarName);
  const normParent = normalizeComparisonName(parentName);
  const normCultivar = cultivarName ? normalizeComparisonName(cultivarName) : null;

  const scored = (candidates || []).map((c) => {
    const normName = normalizeComparisonName(c.rawName);
    let reason;
    let score;

    if (isCultivarQuery) {
      const containsParent = normName.includes(normParent) || (normParent && normParent.includes(normName));
      const containsCultivar = Boolean(normCultivar) && normName.includes(normCultivar);
      if (containsParent && containsCultivar) {
        reason = "exact_cultivar_match";
        score = 100;
      } else if (normName === normParent) {
        reason = "parent_only";
        score = 70;
      } else if (containsCultivar) {
        // Names the cultivar but not clearly the same botanical parent —
        // not safe to treat as a confident match either way.
        reason = "ambiguous";
        score = 40;
      } else if (containsParent) {
        reason = "parent_taxon_match";
        score = 55;
      } else {
        reason = "fuzzy_candidate";
        score = 10;
      }
    } else {
      if (normName === normParent) {
        reason = "exact_scientific_match";
        score = 100;
      } else if (normName.startsWith(`${normParent} `) || normParent.startsWith(`${normName} `)) {
        reason = "parent_taxon_match";
        score = 55;
      } else if (normName.split(" ")[0] && normName.split(" ")[0] === normParent.split(" ")[0]) {
        reason = "ambiguous";
        score = 30;
      } else {
        reason = "fuzzy_candidate";
        score = 10;
      }
    }

    return { ...c, normalized_comparison_name: normName, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { selected: null, selection_reason: "not_found", candidates: scored };
  }

  const best = scored[0];
  const runnerUp = scored[1];

  // A tie among the top candidates below a confident (100) score means the
  // choice is not reliable — surface it as ambiguous rather than picking
  // arbitrarily between two equally-plausible records.
  if (runnerUp && runnerUp.score === best.score && best.score < 100) {
    return { selected: best, selection_reason: "ambiguous", candidates: scored };
  }

  return { selected: best, selection_reason: best.reason, candidates: scored };
}
