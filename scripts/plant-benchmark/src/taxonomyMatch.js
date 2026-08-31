// Parses "Genus species 'Cultivar'" into its botanical parent and cultivar
// epithet. Never guesses which name WCVP should return — that comes only
// from the actual WCVP query result (spec §5/§18). The parent name is what
// gets sent to every taxonomy/horticulture source; the cultivar name is
// never sent to WCVP.
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
 * classifyMatch — cross-checks a provider's OWN selected scientific name
 * (already chosen via candidateSelection.selectCandidate on that
 * provider's own search results) against the WCVP record independently
 * fetched for this plant. This never decides botany itself — it only
 * compares strings/records that were retrieved from two separate sources
 * (spec §10), and is distinct from (and runs after) each provider's own
 * `selection_reason` (which candidate, among ITS OWN results, was picked).
 *
 * Returns one of: exact_accepted_match | synonym_match | parent_taxon_match
 * | ambiguous | not_found | taxonomy_conflict
 */
export function classifyMatch({ providerName, wcvpTaxonomy, cultivarParentName }) {
  if (!providerName) return "not_found";
  if (!wcvpTaxonomy || !wcvpTaxonomy.taxonomic_status) return "not_found";

  const candidate = normalizeName(providerName);
  const accepted = normalizeName(wcvpTaxonomy.accepted_name);
  const canonical = normalizeName(wcvpTaxonomy.canonical_name);
  const synonyms = (wcvpTaxonomy.synonyms || []).map(normalizeName);
  const parent = normalizeName(cultivarParentName);

  if (candidate === accepted || candidate === canonical) {
    return "exact_accepted_match";
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
