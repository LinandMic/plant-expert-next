import { crosswalkRank } from "./crosswalks.js";
import { taxonRef } from "./refs.js";

function normalizeName(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// buildTaxonDryRun(wcvpTaxonomy) — pure. wcvpTaxonomy is the `taxonomy`
// object returned by the (reused, unmodified) benchmark WCVP provider.
// Returns { taxon, taxon_ref, warnings, blocked }. `blocked: true` means no
// safe taxon dry-run object could be built — this must never be papered
// over with an invented taxon (spec §6/§16): callers must not build a
// catalog entry when this is blocked.
export function buildTaxonDryRun(wcvpTaxonomy) {
  const warnings = [];

  if (!wcvpTaxonomy || wcvpTaxonomy.taxonomic_status !== "ACCEPTED" && wcvpTaxonomy.taxonomic_status !== "accepted") {
    // Also covers wcvpTaxonomy === null (not_found/ambiguous/provider_error
    // upstream never produce a usable taxonomy — see queryWcvp).
    if (wcvpTaxonomy && wcvpTaxonomy.taxonomic_status) {
      warnings.push(`WCVP taxonomic_status "${wcvpTaxonomy.taxonomic_status}" is not accepted — no taxon dry-run built`);
    } else {
      warnings.push("WCVP did not resolve an accepted taxon — no taxon dry-run built");
    }
    return { taxon: null, taxon_ref: null, warnings, blocked: true };
  }

  const rank = crosswalkRank(wcvpTaxonomy.taxonomic_rank);
  if (!rank) {
    warnings.push(`WCVP rank "${wcvpTaxonomy.taxonomic_rank}" is not in the rank crosswalk — no taxon dry-run built`);
    return { taxon: null, taxon_ref: null, warnings, blocked: true };
  }

  const ref = taxonRef(wcvpTaxonomy.canonical_name);

  // scientific_name_full: only set when we actually have a distinguishable
  // fuller form than canonical_name (e.g. one carries authorship and the
  // other doesn't) — usageFromRaw() collapses canonicalName/scientificName
  // into a single `raw_name`, so this is the only non-invented signal
  // available from the reused WCVP provider's output shape.
  const rawName = wcvpTaxonomy.accepted_name || null;
  const scientificNameFull = rawName && normalizeName(rawName) !== normalizeName(wcvpTaxonomy.canonical_name) ? rawName : null;

  const taxon = {
    taxon_ref: ref,
    rank,
    genus: wcvpTaxonomy.genus ?? null,
    species: wcvpTaxonomy.species ?? null,
    infraspecific_epithet: wcvpTaxonomy.infraspecific_name ?? null,
    canonical_name: wcvpTaxonomy.canonical_name ?? null,
    scientific_name_full: scientificNameFull,
    family: wcvpTaxonomy.family ?? null,
    taxonomic_status: "accepted",
    wcvp_taxon_id: wcvpTaxonomy.accepted_taxon_id != null ? String(wcvpTaxonomy.accepted_taxon_id) : null,
  };

  return { taxon, taxon_ref: ref, warnings, blocked: false };
}

// buildTaxonNames(wcvpTaxonomy, taxonRefValue) — pure. Only the accepted
// name plus WCVP-provided synonyms actually present in wcvpTaxonomy.synonyms
// (spec §7) — no synonym is ever invented. Each synonym's own WCVP name-id
// is not available from the reused provider's output shape (only the
// resolved synonym name STRING is), so source_taxon_id stays null for
// synonym rows rather than a fabricated id.
export function buildTaxonNames(wcvpTaxonomy, taxonRefValue) {
  if (!wcvpTaxonomy || !wcvpTaxonomy.canonical_name) return [];

  const names = [
    {
      taxon_ref: taxonRefValue,
      name: wcvpTaxonomy.accepted_name || wcvpTaxonomy.canonical_name,
      normalized_name: normalizeName(wcvpTaxonomy.accepted_name || wcvpTaxonomy.canonical_name),
      name_type: "accepted",
      source_taxon_id: wcvpTaxonomy.accepted_taxon_id != null ? String(wcvpTaxonomy.accepted_taxon_id) : null,
    },
  ];

  for (const synonym of wcvpTaxonomy.synonyms || []) {
    if (!synonym) continue;
    names.push({
      taxon_ref: taxonRefValue,
      name: synonym,
      normalized_name: normalizeName(synonym),
      name_type: "synonym",
      source_taxon_id: null,
    });
  }

  return names;
}
