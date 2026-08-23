import { writeFileSync } from "node:fs";

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function percent(found, total) {
  return total ? round1((found / total) * 100) : 0;
}

// Deterministic informative-presence check, used everywhere coverage
// decides whether an observation's `normalized_value` counts as "the
// provider actually gave us something" — corrected: an empty array/object/
// string was previously counted as present just because it wasn't
// `null`/`undefined` (e.g. Perenual's real `attracts: []`, `soil: []`
// would have inflated coverage despite carrying zero information).
//   missing: null, undefined, "" / whitespace-only string, [], {} (or an
//            object whose own values are themselves all non-informative).
//   present: false, 0, any other non-empty string/number, non-empty
//            arrays (regardless of element content), objects with at
//            least one informative value.
export function hasInformativeValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(hasInformativeValue);
  return true; // booleans (including false) and numbers (including 0)
}

// Canonical traits the future Plant Finder actually wants to evaluate,
// independent of what any given provider happens to return. This list is
// fixed by us, not discovered from a response — a provider missing a
// BENCHMARK_TRAIT entirely still reports it at 0% rather than silently
// dropping it from coverage.csv/report.md.
//
// Every name below is one already genuinely implemented by a provider
// mapper (src/providers/perenual.js, src/providers/trefle.js) — nothing
// here is an invented field or a provider mapping fabricated to fill a
// gap. Where a provider's raw field doesn't cleanly match one of these
// concepts (e.g. Perenual's generic `soil` field, Trefle's
// `atmospheric_humidity` or precipitation fields), it is deliberately left
// out of this canonical list and instead surfaces under
// extra_discovered_traits — no semantic renaming to force a fit.
export const BENCHMARK_TRAITS = [
  // dimensions
  "height_min_cm",
  "height_max_cm",
  "spread_max_cm",
  // growth form (Trefle `specifications.growth_form` ONLY)
  "growth_form",
  // plant type (Perenual `type` ONLY — e.g. "tree"/"shrub"/"herb").
  // Deliberately split from growth_form: despite the superficial naming
  // overlap, Perenual's `type` and Trefle's `specifications.growth_form`
  // are two distinct provider concepts and are never merged under any
  // implicit equivalence rule.
  "plant_type",
  // soleil
  "sun",
  // humidité du sol
  "soil_moisture",
  // pH
  "soil_ph_min",
  "soil_ph_max",
  // texture du sol
  "soil_texture",
  // températures / rusticité disponibles
  "min_temperature_c",
  "max_temperature_c",
  "hardiness_min",
  "hardiness_max",
  // feuillage persistant — uniquement si un champ explicite existe côté
  // provider (jamais déduit de `cycle`, voir providers/perenual.js)
  "evergreen",
  // floraison
  "flowering_months",
  // besoin en eau
  "water_need",
  // sécheresse
  "drought_tolerance",
  // pot
  "container_suitable",
  // comestibilité (trois traits distincts, `edible` est une dérivation
  // documentée à 3 états — voir providers/perenual.js)
  "edible",
  "edible_fruit",
  "edible_leaf",
  // croissance
  "growth_rate",
  // attraction / pollinisateurs — nom brut du fournisseur (`attracts`)
  // conservé tel quel, jamais renommé en un concept plus spécifique
  // ("pollinator_value") sans vérification live des données réelles.
  "attracts",
];

// The trait vocabulary actually present in the data — used only to derive
// extra_discovered_traits (traits a provider genuinely returned but that
// are not part of BENCHMARK_TRAITS). Never used to decide what appears in
// the canonical coverage table itself.
export function discoverTraitNames(normalized) {
  const names = new Set();
  for (const plant of normalized) {
    for (const traitName of Object.keys(plant.traits || {})) names.add(traitName);
  }
  return Array.from(names).sort();
}

// A plant only counts toward a provider's "eligible" set when that
// provider's own candidate selection was confident enough that the record
// genuinely describes the queried taxon/cultivar (spec §22/23):
// `skipped_no_key`, `provider_error`, `not_found`, and `ambiguous` are
// excluded — they are not "0 out of a real total", they are simply not
// comparable data points.
export function eligibleCount(normalized, provider) {
  return normalized.filter((p) => {
    const reason = p.providers[provider].selection_reason;
    return reason === "exact_scientific_match" || reason === "exact_cultivar_match" || reason === "parent_taxon_match" || reason === "parent_only";
  }).length;
}

// "Record coverage" — of the WHOLE panel, how many plants got a usable
// record at all from this provider, regardless of whether any individual
// trait was then present on that record. Denominator is always the full
// panel size, never a filtered subset.
export function computeRecordCoverage(normalized, provider) {
  const total = normalized.length;
  const found = eligibleCount(normalized, provider);
  return { found, total, percent: percent(found, total) };
}

// A Perenual Personal-plan key can hit a plan-gated endpoint and get an
// HTTP 429 "upgrade plan" response (see httpClient.js's `plan_restricted`
// detection) — this is a subscription restriction, never evidence that the
// plant is unknown or that a trait is genuinely missing. Counted
// separately so the plan's limits are never misread as poor botanical
// coverage (spec).
export function computePlanRestrictedCount(normalized, provider) {
  return normalized.filter((p) => p.providers[provider].selection_reason === "plan_restricted").length;
}

// Perenual only: under an explicitly configured limited-catalog access
// tier (PERENUAL_ACCESS_TIER=personal), an empty search cannot be trusted
// as a real `not_found` — see providers/perenual.js's `classifySearchResult`.
// Counted separately, never folded into `not_found` or into "trait missing
// from this provider": absence is not established either way.
export function computeUnresolvedUnderPlanCount(normalized, provider) {
  return normalized.filter((p) => p.providers[provider].selection_reason === "unresolved_under_plan").length;
}

// "Exact cultivar coverage" — restricted to the panel entries that are
// themselves cultivar queries (`input_type === "cultivar"`): how many of
// those got a genuine `exact_cultivar_match`. A `parent_only` result is
// never counted here — it means the provider only ever found the parent
// species, not the cultivar that was actually asked for (spec §13).
export function computeExactCultivarCoverage(normalized, provider) {
  const cultivarPlants = normalized.filter((p) => p.input_type === "cultivar");
  const total = cultivarPlants.length;
  const found = cultivarPlants.filter((p) => p.providers[provider].selection_reason === "exact_cultivar_match").length;
  return { found, total, percent: percent(found, total) };
}

// Core per-trait coverage computation, given an explicit trait list. A
// trait with zero observations from any plant still produces a row (found
// 0, percent 0%) — traits are never dropped just because nothing matched.
function coverageRowsForTraits(normalized, traitNames) {
  const totalPanel = normalized.length;
  const perenualEligible = eligibleCount(normalized, "perenual");
  const trefleEligible = eligibleCount(normalized, "trefle");

  return traitNames.map((trait) => {
    let perenualFound = 0;
    let trefleFound = 0;
    for (const plant of normalized) {
      const entry = plant.traits[trait];
      if (!entry) continue;
      if (entry.observations.some((o) => o.provider === "perenual" && hasInformativeValue(o.normalized_value))) {
        perenualFound++;
      }
      if (entry.observations.some((o) => o.provider === "trefle" && hasInformativeValue(o.normalized_value))) {
        trefleFound++;
      }
    }
    return {
      trait,
      perenual_found: perenualFound,
      perenual_conditional_total: perenualEligible,
      perenual_conditional_percent: percent(perenualFound, perenualEligible),
      perenual_end_to_end_total: totalPanel,
      perenual_end_to_end_percent: percent(perenualFound, totalPanel),
      trefle_found: trefleFound,
      trefle_conditional_total: trefleEligible,
      trefle_conditional_percent: percent(trefleFound, trefleEligible),
      trefle_end_to_end_total: totalPanel,
      trefle_end_to_end_percent: percent(trefleFound, totalPanel),
    };
  });
}

// Per-trait coverage for the canonical BENCHMARK_TRAITS list, reported two
// ways, never conflated (spec §22/23):
//  - "conditional" coverage: of the plants where this provider actually
//    produced a usable record (`eligibleCount`), how many carried this
//    trait. Answers "when the provider had a record, how often did we
//    actually get this trait".
//  - "end-to-end" coverage: of the WHOLE panel, how many plants ended up
//    with this trait from this provider. Answers "for a random plant on
//    this panel, how likely is this trait to actually be there" — it folds
//    in the record-coverage gap (missing/not_found/ambiguous/provider_error
//    plants) instead of hiding it behind a smaller denominator.
// Every BENCHMARK_TRAIT always produces a row, even at 0%/0 — a trait no
// provider ever filled is not omitted, it is explicit evidence of a gap.
export function computeCoverage(normalized) {
  return coverageRowsForTraits(normalized, BENCHMARK_TRAITS);
}

// Traits genuinely present in the data but NOT part of the canonical
// BENCHMARK_TRAITS list (e.g. Trefle's atmospheric_humidity/precipitation
// fields, Perenual's generic `soil`). Kept in a clearly separate result so
// they never silently widen or redefine the fixed evaluation criteria.
export function computeExtraDiscoveredTraitCoverage(normalized) {
  const extra = discoverTraitNames(normalized).filter((t) => !BENCHMARK_TRAITS.includes(t));
  return coverageRowsForTraits(normalized, extra);
}

const CSV_HEADER = [
  "trait", "trait_scope",
  "perenual_found", "perenual_conditional_total", "perenual_conditional_percent", "perenual_end_to_end_total", "perenual_end_to_end_percent",
  "trefle_found", "trefle_conditional_total", "trefle_conditional_percent", "trefle_end_to_end_total", "trefle_end_to_end_percent",
];

export function writeCoverageCsv(normalized, outPath) {
  const canonicalRows = computeCoverage(normalized).map((r) => ({ ...r, trait_scope: "benchmark_trait" }));
  const extraRows = computeExtraDiscoveredTraitCoverage(normalized).map((r) => ({ ...r, trait_scope: "extra_discovered_trait" }));
  const rows = [...canonicalRows, ...extraRows];
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(CSV_HEADER.map((k) => csvEscape(r[k])).join(","));
  }
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}
