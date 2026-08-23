// Explicit, deterministic, testable crosswalk tables only. No fuzzy/AI
// mapping — an unrecognized provider value never gets a guessed canonical
// value; it is dropped with an explicit warning instead (spec §11).

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
// canonical is null (never []) when nothing in rawArray maps.
export function crosswalkSunArray(rawArray) {
  if (!Array.isArray(rawArray) || rawArray.length === 0) return { canonical: null, warnings: [] };
  const canonical = [];
  const warnings = [];
  for (const raw of rawArray) {
    const mapped = crosswalkSunValue(raw);
    if (mapped) {
      if (!canonical.includes(mapped)) canonical.push(mapped);
    } else {
      warnings.push(`sun crosswalk: unmapped provider value "${raw}" — no canonical value produced for it`);
    }
  }
  return { canonical: canonical.length > 0 ? canonical : null, warnings };
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
