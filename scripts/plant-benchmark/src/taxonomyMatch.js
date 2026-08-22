// Parses "Genus species 'Cultivar'" into its botanical parent and cultivar
// epithet. Never guesses which name WCVP should return — that comes only
// from the actual WCVP query result (spec §4/§5).
export function parseCultivarName(inputName) {
  const match = /^(.*?)\s*'([^']+)'\s*$/.exec(inputName.trim());
  if (match) {
    return { parentName: match[1].trim(), cultivarName: match[2].trim() };
  }
  return { parentName: inputName.trim(), cultivarName: null };
}

function normalizeName(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Classifies a provider's scientific name against the WCVP record already
 * fetched for this plant. This function never decides botany itself — it
 * only compares strings/records that were independently retrieved from two
 * separate sources (spec §10).
 *
 * Returns one of: exact_accepted_match | synonym_match | parent_taxon_match
 * | cultivar_parent_match | ambiguous | not_found | taxonomy_conflict
 */
export function classifyMatch({ providerName, wcvpRecord, isCultivarInput, cultivarParentName }) {
  if (!providerName) return "not_found";
  if (!wcvpRecord || !wcvpRecord.taxonomic_status) return "not_found";

  const candidate = normalizeName(providerName);
  const accepted = normalizeName(wcvpRecord.accepted_name);
  const canonical = normalizeName(wcvpRecord.canonical_name);
  const synonyms = (wcvpRecord.synonyms || []).map(normalizeName);
  const parent = normalizeName(cultivarParentName);
  const isAccepted = /accepted/i.test(wcvpRecord.taxonomic_status || "");

  if (isCultivarInput && (candidate === parent || candidate === canonical || candidate === accepted)) {
    return "cultivar_parent_match";
  }
  if (candidate === accepted || candidate === canonical) {
    return isAccepted ? "exact_accepted_match" : "taxonomy_conflict";
  }
  if (synonyms.includes(candidate)) {
    return "synonym_match";
  }
  if (parent && candidate === parent) {
    return "parent_taxon_match";
  }
  const candidateGenus = candidate.split(" ")[0];
  if (candidateGenus && accepted.startsWith(`${candidateGenus} `)) {
    return "ambiguous";
  }
  return "taxonomy_conflict";
}
