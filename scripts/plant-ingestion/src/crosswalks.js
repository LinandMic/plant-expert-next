// Explicit, deterministic, testable crosswalk tables only. No fuzzy/AI
// mapping — an unrecognized provider value never gets a guessed canonical
// value; it is dropped with an explicit warning instead (spec §11).

import { isInformative } from "./informative.js";
import { PLANT_TYPE_VALUES } from "./editorial/editorialVocab.js";

// Perenual `sunlight` raw string -> our canonical plant_catalog.sun
// vocabulary (aligned with garden_zones.exposure). ONLY the two mappings
// actually validated against real Perenual data for Acer palmatum are
// present here — "full sun" and "part shade". Any other raw value
// (including plausible-looking ones like "partial sun") is deliberately
// left unmapped until it is itself observed and validated, rather than
// guessed by analogy.
const SUN_CROSSWALK = {
  "full sun": "full_sun",
  "part shade": "partial_sun",
};

export function crosswalkSunValue(rawValue) {
  const key = (rawValue || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUN_CROSSWALK, key) ? SUN_CROSSWALK[key] : null;
}

// crosswalkSunArray(rawArray) -> { canonical, warnings }
// ALL-OR-NOTHING: `canonical` is only ever a complete, trustworthy array —
// never []. If even ONE informative raw value fails to map, `canonical` is
// null (not a partial array silently missing that value): a plant that is
// e.g. both "full sun" AND some unmapped exposure would be badly
// misrepresented by an array that only lists "full_sun", since that reads
// as "full sun only". raw_value on the observation still keeps every
// original provider value regardless (this function never touches it) —
// only the canonical/selectable representation is withheld until the
// crosswalk is complete.
export function crosswalkSunArray(rawArray) {
  const informativeValues = Array.isArray(rawArray) ? rawArray.filter(isInformative) : [];
  if (informativeValues.length === 0) return { canonical: null, warnings: [] };

  const mapped = [];
  const warnings = [];
  let allMapped = true;
  for (const raw of informativeValues) {
    const m = crosswalkSunValue(raw);
    if (m) {
      if (!mapped.includes(m)) mapped.push(m);
    } else {
      allMapped = false;
      warnings.push(`sun crosswalk: unmapped provider value "${raw}" — normalization left incomplete, no canonical value produced for this observation`);
    }
  }
  return { canonical: allMapped ? mapped : null, warnings };
}

// Provider `plant_type`-ish raw string (Perenual's `type`, e.g. "Tree",
// "Broadleaf evergreen") -> our canonical plant_catalog.plant_type
// vocabulary (PLANT_TYPE_VALUES, duplicated from lib/plantFinderFormat.js —
// see editorial/editorialVocab.js's own comment on that boundary).
//
// Real bug found auditing mini-batch-2 (Betula/Buxus, 2026-09): before this
// crosswalk existed, plant_type went through the same raw passthrough as
// any other "deterministic" trait (see selections.js's
// proposeDeterministicNumericOrPassthrough) — a provider's raw string was
// copied straight into a proposed selection with zero vocabulary check, so
// "Tree" and "Broadleaf evergreen" would both have become real
// plant_catalog.plant_type values verbatim (the latter already leaked into
// production this way for Camellia japonica in an earlier, pre-normalization
// round). This crosswalk is deliberately narrow: it ONLY recognizes an
// EXACT match (case/whitespace-insensitive) against the existing,
// already-validated PLANT_TYPE_VALUES enum — never a semantic guess. A
// value like "Broadleaf evergreen" is real botanical information (a
// grower's classification, genuinely ambiguous between shrub/tree without
// a species-specific judgment this crosswalk has no basis to make) and is
// deliberately left unmapped, exactly like an unmapped sun value above: the
// raw observation is kept, no canonical value/selection is fabricated for
// it.
export function crosswalkPlantTypeValue(rawValue) {
  const key = (rawValue || "").trim().toLowerCase();
  return PLANT_TYPE_VALUES.includes(key) ? key : null;
}

// GBIF/WCVP `rank` string -> our plant_taxa.rank vocabulary
// ('genus'|'species'|'subspecies'|'variety'|'form'). Unrecognized ranks
// stay null with a warning rather than a guess.
const RANK_CROSSWALK = {
  genus: "genus",
  species: "species",
  subspecies: "subspecies",
  variety: "variety",
  form: "form",
};

export function crosswalkRank(rawRank) {
  const key = (rawRank || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK_CROSSWALK, key) ? RANK_CROSSWALK[key] : null;
}

// Narrow provider_status enum used by plant_source_records (matches the
// migration's CHECK constraint exactly). A provider's own richer
// `status`/`selection_reason` vocabulary (exact_scientific_match,
// ambiguous, parent_taxon_match, fuzzy_candidate, parent_only, ...) is
// matching-QUALITY information — it belongs in selection_reason, never
// here. `unresolved_under_plan` is already a narrow-set value and must
// never be collapsed into `not_found` (spec §8).
const NARROW_PROVIDER_STATUSES = new Set([
  "ok",
  "not_found",
  "plan_restricted",
  "unresolved_under_plan",
  "provider_error",
  "skipped_no_key",
]);

// deriveProviderStatus(rawStatus) — pure. If the provider result's own
// `status` is already one of the narrow operational outcomes, it is kept
// as-is. Otherwise the provider DID return an operationally successful
// response (a match evaluation happened, e.g. "exact_scientific_match",
// "ambiguous", "parent_taxon_match") — that is `ok` at the provider_status
// level; the matching-quality nuance is preserved separately as
// selection_reason.
export function deriveProviderStatus(rawStatus) {
  return NARROW_PROVIDER_STATUSES.has(rawStatus) ? rawStatus : "ok";
}
