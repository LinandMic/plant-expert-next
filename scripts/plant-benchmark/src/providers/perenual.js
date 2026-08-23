// Perenual provider — horticultural traits and cultivar identification
// (spec §2-5, §11-14).
//
// Candidate selection (spec §11/§12/§14): never `candidates[0]` — every
// search result is scored with the same `selectCandidate` logic shared
// across providers, and the full scored candidate list is kept for audit.
//
// Cultivar handling (spec §13): if the input is a cultivar and Perenual's
// best candidate is only the parent species, `selection_reason` is
// `parent_only`, never presented as a full cultivar match.
//
// The trait-mapping logic is a pure function (`mapPerenualDetailToTraits`)
// deliberately separated from the network call, so it can be unit tested
// with small fixture objects — no network, no real API — see
// scripts/plant-benchmark/test/perenual.test.js.
//
// CORRECTIONS applied after testing the REAL API from a normal network
// environment (a real `species/details` response for Acer palmatum):
//  - `dimensions` is actually an ARRAY of `{ type, min_value, max_value,
//    unit }` entries (e.g. `[{ type: "Height", min_value: 20, max_value:
//    20, unit: "feet" }]`), not the single object this benchmark assumed
//    before real testing. The array form is now the primary shape; the
//    documented object form is kept only as a compatibility fallback.
//  - `container` and `indoor` are genuinely independent fields (a real
//    response had `container: null, indoor: false` together) —
//    `container_suitable` is now derived ONLY from `container`, never
//    `container ?? indoor`.
//  - `flowering_season` (e.g. "Spring") is a season, not a month list —
//    it is never used to populate `flowering_months`.
//  - a real Personal-plan key hit Perenual's plan-gated `species/details`
//    endpoint and got HTTP 429 with an upgrade-plan message — see
//    `httpClient.js`'s `plan_restricted` classification, propagated here
//    as its own `selection_reason`, never `not_found`/`provider_error`.
//    CORRECTED further: this is only trustworthy as `plan_restricted` for
//    the QUERIED target when the search itself confidently matched that
//    target (`exact_scientific_match`/`exact_cultivar_match`). Several
//    real cases (querying "Viburnum tinus", "Hosta", "Miscanthus
//    sinensis", "Malus domestica") only ever matched a related/looser
//    candidate (a cultivar, a genus-level entry) via `parent_taxon_match`/
//    `ambiguous`/fuzzy scoring, and IT is what returned 429 — a 429 on a
//    candidate that was never confidently the target does not prove the
//    target itself is plan-restricted. That case is `unresolved_under_plan`
//    instead (same vocabulary as the empty-search case above — both mean
//    "no confident, complete answer for this target under this plan").
//  - separately, the SAME Personal-plan key ran a search that returned
//    HTTP 200 with `data: []` for a plant later confirmed to exist in
//    Perenual's catalog — Perenual documents the Personal tier as limited
//    to a subset of species ("Species Data 1-3000"). Under an explicitly
//    configured limited-catalog tier (`PERENUAL_ACCESS_TIER=personal`), an
//    empty search is therefore NOT scientific proof of absence — it is
//    classified `unresolved_under_plan`, distinct from both `not_found`
//    (absence reasonably established) and `plan_restricted` (a specific
//    429+upgrade-message response actually observed). This reclassification
//    only ever fires when the tier is explicitly configured as limited —
//    an unset/unknown/full-access tier never fabricates it.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation, convertToCm } from "../normalize.js";
import { selectCandidate } from "../candidateSelection.js";

const BASE = "https://perenual.com/api/v2";

// Fallback (documented-but-not-observed-live) object shape:
// `dimensions: { min_value, max_value, unit }` directly, no `type`. Kept
// only for compatibility — real responses use the array form below.
export function extractDimensionCm(dimensions, key) {
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return { raw: null, unit: null, cm: null };
  const raw = dimensions[key];
  const unit = dimensions.unit ?? null;
  if (raw === undefined || raw === null) return { raw: null, unit, cm: null };
  return { raw, unit, cm: convertToCm(typeof raw === "number" ? raw : Number(raw), unit) };
}

// Real shape, verified live: `dimensions` is an array, one entry per
// measured dimension, each `{ type, min_value, max_value, unit }`. `type`
// is matched case-insensitively against a small, explicit whitelist —
// only a dimension whose meaning is unambiguous is ever mapped to a
// trait; anything else is left unmapped rather than guessed (spec: "ne
// mappe un autre type comme largeur/spread que si son sens est
// explicitement déterminable").
const DIMENSION_TYPE_TRAIT_PREFIX = {
  height: "height",
  spread: "spread",
  width: "spread",
};

export function extractDimensionEntriesCm(dimensions) {
  if (!Array.isArray(dimensions)) return [];
  const out = [];
  for (const entry of dimensions) {
    if (!entry || typeof entry !== "object") continue;
    const traitPrefix = DIMENSION_TYPE_TRAIT_PREFIX[String(entry.type || "").trim().toLowerCase()];
    if (!traitPrefix) continue; // unrecognized dimension type — never guessed
    const unit = entry.unit ?? null;
    const rawMin = entry.min_value ?? null;
    const rawMax = entry.max_value ?? null;
    out.push({
      traitPrefix,
      rawMin,
      rawMax,
      unit,
      minCm: rawMin !== null ? convertToCm(typeof rawMin === "number" ? rawMin : Number(rawMin), unit) : null,
      maxCm: rawMax !== null ? convertToCm(typeof rawMax === "number" ? rawMax : Number(rawMax), unit) : null,
    });
  }
  return out;
}

// Perenual tiers documented (by Perenual) as giving access to only a
// SUBSET of the catalog. Only these tiers can ever trigger the
// `unresolved_under_plan` reclassification below — deliberately NOT a
// blanket assumption applied to every Perenual account (spec: "ne
// hardcode pas arbitrairement cette hypothèse pour tous les comptes
// Perenual"). Extend this set if Perenual documents another limited tier;
// `premium`/`supreme` are NOT included here because they are not
// documented as catalog-limited — an empty search under those tiers (or
// under an unset/unknown tier) stays a normal `not_found`.
const LIMITED_CATALOG_ACCESS_TIERS = new Set(["personal"]);

export function isLimitedCatalogAccessTier(accessTier) {
  return LIMITED_CATALOG_ACCESS_TIERS.has((accessTier || "").trim().toLowerCase());
}

/**
 * classifySearchResult — pure. Given how many candidates a Perenual search
 * actually returned and the configured access tier, decides whether an
 * EMPTY result can be trusted as a real `not_found` or must instead be
 * reported as `unresolved_under_plan` (catalog coverage unknown under this
 * tier, absence not scientifically established). Returns `null` when
 * normal candidate selection should proceed unmodified — i.e. whenever
 * there ARE candidates, or the tier isn't a documented limited-catalog one.
 */
export function classifySearchResult({ rawCandidatesLength, accessTier }) {
  if (rawCandidatesLength === 0 && isLimitedCatalogAccessTier(accessTier)) {
    return "unresolved_under_plan";
  }
  return null;
}

/**
 * classifyDetailFailure — pure. A 429 "Please Upgrade Plan" on the detail
 * endpoint is only proof that the QUERIED TARGET is plan-restricted when
 * the search itself confidently matched that target
 * (exact_scientific_match/exact_cultivar_match). A 429 on a merely
 * related candidate (parent_taxon_match/ambiguous/fuzzy — e.g. querying
 * "Viburnum tinus" but only ever matching "Viburnum tinus 'Lisarose'")
 * never proves the target itself is restricted — that case is
 * `unresolved_under_plan` instead, never a false `plan_restricted` claim.
 * Returns `null` when the detail failure isn't plan-restricted at all —
 * signals "keep the prior provider_error / original selection_reason
 * behavior", unrelated to this correction.
 */
export function classifyDetailFailure({ selectionReason, detailError }) {
  if (detailError !== "plan_restricted") return null;
  const isConfidentTargetMatch = selectionReason === "exact_scientific_match" || selectionReason === "exact_cultivar_match";
  return isConfidentTargetMatch ? "plan_restricted" : "unresolved_under_plan";
}

/**
 * mapPerenualDetailToTraits — pure. Given a `species/details/{id}` payload
 * (`d`), returns { traits, cultivarField, varietyField, subspeciesField,
 * hybridField }. No network, no side effects — safe to unit test with a
 * tiny fixture object.
 */
export function mapPerenualDetailToTraits({ candidateId, sourceUrl, detailData, retrievedAt }) {
  const d = detailData || {};
  const traits = {};

  function add(trait, rawValue, normalizedValue, opts = {}) {
    if (rawValue === undefined || rawValue === null) return;
    pushObservation(traits, trait, makeObservation({
      provider: "perenual",
      rawValue,
      normalizedValue: normalizedValue === undefined ? rawValue : normalizedValue,
      sourceRecordId: candidateId != null ? String(candidateId) : null,
      sourceUrl,
      retrievedAt,
      ...opts,
    }));
  }

  // --- Spec §3: traits fetched as-is, no surinterpretation. ---
  // Corrected: Perenual's `type` (e.g. "tree"/"shrub"/"herb") is a
  // distinct concept from Trefle's `specifications.growth_form` despite
  // the naming overlap this benchmark previously conflated them under —
  // never merged, see `plant_type` vs `growth_form` in coverage.js.
  add("plant_type", d.type);
  add("sun", d.sunlight);
  add("soil", d.soil);
  add("growth_rate", d.growth_rate);
  add("drought_tolerance", d.drought_tolerant);
  add("attracts", d.attracts);
  add("water_need", d.watering);

  // --- Corrected: `container` and `indoor` are independent fields (a real
  // response had `container: null, indoor: false` — `indoor=false` does
  // NOT mean "not container-suitable"). `container_suitable` comes ONLY
  // from `container`; `container=null`/absent leaves it unmapped, never
  // guessed from `indoor`. `indoor` is kept as its own distinct raw trait.
  add("container_suitable", d.container, d.container);
  add("indoor", d.indoor, d.indoor);

  if (d.hardiness && d.hardiness.min !== undefined) add("hardiness_min", d.hardiness.min);
  if (d.hardiness && d.hardiness.max !== undefined) add("hardiness_max", d.hardiness.max);

  // --- Corrected: `flowering_season` (e.g. "Spring") is a SEASON, not a
  // list of months — never auto-translate "Spring" into March/April/May
  // or any other guessed month set. Kept as its own distinct raw trait;
  // `flowering_months` is only ever populated from genuine month data,
  // which Perenual's observed shape does not provide, so it stays
  // unmapped for this provider.
  add("flowering_season", d.flowering_season, d.flowering_season);

  // --- Spec §4: evergreen — `cycle` removed as a source. It describes the
  // plant's life cycle (annual/perennial/biennial), not leaf retention,
  // and must never be used to infer evergreen/deciduous. Only an explicit,
  // clearly-named field is used, if one is genuinely present. No such
  // field has a confirmed name in Perenual's documented shape at the time
  // of writing, so this deliberately stays unmapped (null) rather than
  // guessing a field name that would silently never match, or worse,
  // silently match something unrelated.
  if (typeof d.leaf_retention === "boolean") {
    add("evergreen", d.leaf_retention, d.leaf_retention);
  } else if (typeof d.evergreen === "boolean") {
    add("evergreen", d.evergreen, d.evergreen);
  }

  // --- Spec §5 (corrected): edible_fruit/edible_leaf always kept separate.
  // `edible` is a three-state derived rule, never a naive "any explicit
  // false wins":
  //   - >=1 supported component explicitly true  -> true
  //   - EVERY supported component is explicitly present AND false -> false
  //   - anything else (a component missing/null/unknown, no true, not all
  //     false) -> null — genuinely unknown, never guessed either way.
  // `edible` is only added at all when at least one component was
  // genuinely present in the response (mirrors edible_fruit/edible_leaf's
  // own presence check) — if the API said nothing whatsoever about
  // edibility, no `edible` observation is fabricated.
  const fruitVal = d.edible_fruit;
  const leafVal = d.edible_leaf;
  if (fruitVal !== undefined) add("edible_fruit", fruitVal, fruitVal);
  if (leafVal !== undefined) add("edible_leaf", leafVal, leafVal);
  if (fruitVal !== undefined || leafVal !== undefined) {
    const components = [fruitVal, leafVal];
    const anyTrue = components.some((v) => v === true);
    const allExplicitlyFalse = components.every((v) => v === false);
    const derivedEdible = anyTrue ? true : allExplicitlyFalse ? false : null;
    add("edible", { edible_fruit: fruitVal ?? null, edible_leaf: leafVal ?? null }, derivedEdible);
  }

  // --- Dimensions (spec §2, corrected against a real response): the
  // array form `[{ type, min_value, max_value, unit }]` is the primary
  // shape — deterministic cm conversion only for supported units, never a
  // fabricated width/spread when only a height entry is present. The
  // single-object form is a compatibility fallback for the documented (but
  // not observed live) shape.
  if (Array.isArray(d.dimensions)) {
    for (const entry of extractDimensionEntriesCm(d.dimensions)) {
      if (entry.rawMax !== null) {
        add(`${entry.traitPrefix}_max_cm`, entry.rawMax, entry.maxCm, {
          fieldPath: `dimensions[type=${entry.traitPrefix}].max_value`,
          rawUnit: entry.unit,
          normalizedUnit: entry.maxCm !== null ? "cm" : null,
          uncertain: entry.maxCm === null,
        });
      }
      if (entry.rawMin !== null) {
        add(`${entry.traitPrefix}_min_cm`, entry.rawMin, entry.minCm, {
          fieldPath: `dimensions[type=${entry.traitPrefix}].min_value`,
          rawUnit: entry.unit,
          normalizedUnit: entry.minCm !== null ? "cm" : null,
          uncertain: entry.minCm === null,
        });
      }
    }
  } else if (d.dimensions && typeof d.dimensions === "object") {
    const maxDim = extractDimensionCm(d.dimensions, "max_value");
    const minDim = extractDimensionCm(d.dimensions, "min_value");
    if (maxDim.raw !== null) {
      add("height_max_cm", maxDim.raw, maxDim.cm, { fieldPath: "dimensions.max_value", rawUnit: maxDim.unit, normalizedUnit: maxDim.cm !== null ? "cm" : null, uncertain: maxDim.cm === null });
    }
    if (minDim.raw !== null) {
      add("height_min_cm", minDim.raw, minDim.cm, { fieldPath: "dimensions.min_value", rawUnit: minDim.unit, normalizedUnit: minDim.cm !== null ? "cm" : null, uncertain: minDim.cm === null });
    }
  }

  return {
    traits,
    cultivarField: d.cultivar ?? null,
    varietyField: d.variety ?? null,
    subspeciesField: d.subspecies ?? null,
    hybridField: d.hybrid ?? null,
  };
}

// Only these selection reasons mean the search CONFIDENTLY matched the
// actual queried target — only for these is it worth spending a detail
// request (spec correction). A parent_taxon_match/parent_only/ambiguous/
// fuzzy_candidate result was never proven to BE the target (real cases:
// "Viburnum tinus" only ever matched "Viburnum tinus 'Lisarose'", "Hosta"
// only matched "Hosta 'Abby'", "Miscanthus sinensis" only matched
// "Miscanthus sinensis 'Autumn Light'", "Malus domestica" only matched a
// Goldrush cultivar) — fetching ITS details answers a question that was
// never asked, wastes a rate-limited/plan-gated request, and can spuriously
// populate errors.json with a failure unrelated to the actual target.
const CONFIDENT_MATCH_REASONS = new Set(["exact_scientific_match", "exact_cultivar_match"]);

export async function queryPerenual({ inputName, rawRoot, apiKey, accessTier = null, fetchImpl = fetchJson }) {
  const slug = slugify(inputName);
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return { input_name: inputName, status: "skipped_no_key", selection_reason: "skipped_no_key", error: null, record: null, candidates: [], traits: {} };
  }

  const searchUrl = `${BASE}/species-list?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(inputName)}`;
  const searchResult = await fetchImpl(searchUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.search`, { input_name: inputName, result: searchResult });

  if (!searchResult.ok) {
    // Spec correction: a 429 with an "upgrade plan" body is a subscription
    // restriction, never a botanical `not_found`/generic `provider_error`
    // — it must be visible as its own state so Personal-plan limits aren't
    // misread as poor botanical coverage.
    const reason = searchResult.error === "plan_restricted" ? "plan_restricted" : "provider_error";
    return {
      input_name: inputName,
      status: reason,
      selection_reason: reason,
      error: { provider: "perenual", status: "error", http_status: searchResult.status ?? null, message: searchResult.error, retrieved_at: retrievedAt },
      record: null,
      candidates: [],
      traits: {},
    };
  }

  const rawCandidates = (searchResult.data && searchResult.data.data) || [];

  // Spec correction: an empty search is only trustworthy as `not_found`
  // when the configured access tier isn't a documented limited-catalog
  // one. Under `PERENUAL_ACCESS_TIER=personal`, HTTP 200 + `data: []` does
  // not establish absence — see `classifySearchResult` above.
  const earlyClassification = classifySearchResult({ rawCandidatesLength: rawCandidates.length, accessTier });
  if (earlyClassification) {
    return {
      input_name: inputName,
      status: earlyClassification,
      selection_reason: earlyClassification,
      error: null,
      record: null,
      candidates: [],
      traits: {},
    };
  }

  // Parse the query the same way WCVP does, so a cultivar query is scored
  // as a cultivar query here too (spec §11-13).
  const cultivarMatch = /^(.*?)\s*'([^']+)'\s*$/.exec(inputName.trim());
  const parentName = cultivarMatch ? cultivarMatch[1].trim() : inputName.trim();
  const cultivarName = cultivarMatch ? cultivarMatch[2].trim() : null;

  const candidateInputs = rawCandidates.map((c) => ({
    id: c.id,
    rawName: Array.isArray(c.scientific_name) ? c.scientific_name[0] ?? "" : (c.scientific_name ?? ""),
    raw: c,
  }));

  const { selected, selection_reason, candidates } = selectCandidate({ parentName, cultivarName, candidates: candidateInputs });
  const auditedCandidates = candidates.slice(0, 5).map((c) => ({ id: c.id, name: c.rawName, score: c.score, reason: c.reason }));

  if (!selected) {
    return { input_name: inputName, status: "not_found", selection_reason: "not_found", error: null, record: null, candidates: auditedCandidates, traits: {} };
  }

  const candidate = selected.raw;
  const baseRecord = {
    id: candidate.id ?? null,
    provider_name: candidate.common_name ?? null,
    scientific_name: selected.rawName || null,
    other_name: candidate.other_name ?? null,
  };

  if (!CONFIDENT_MATCH_REASONS.has(selection_reason)) {
    // Spec correction: never fetch /species/details for a candidate that
    // wasn't confidently proven to be the queried target. `record` stays
    // exactly what the search itself returned — never presented as a
    // validated detail fiche — and `traits` stays empty since detail data
    // was never fetched. No detail request means no possible spurious
    // errors.json entry from this candidate either.
    return {
      input_name: inputName,
      status: selection_reason,
      selection_reason,
      candidate_count: rawCandidates.length,
      error: null,
      candidates: auditedCandidates,
      record: baseRecord,
      traits: {},
    };
  }

  const detailUrl = `${BASE}/species/details/${candidate.id}?key=${encodeURIComponent(apiKey)}`;
  const detailResult = await fetchImpl(detailUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.detail`, { input_name: inputName, result: detailResult });

  if (!detailResult.ok) {
    // Spec correction: a 429 "Please Upgrade Plan" on the detail endpoint
    // is only proof that THE QUERIED TARGET is plan-restricted when the
    // search itself confidently matched that target
    // (exact_scientific_match/exact_cultivar_match). Real cases observed:
    // querying "Viburnum tinus" only matched "Viburnum tinus 'Lisarose'"
    // (parent_taxon_match); "Hosta" only matched "Hosta 'Abby'"; querying
    // a species only matched an unrelated cultivar — in each case the 429
    // was on that LOOSER candidate's detail fetch, never proven to be
    // about the target itself. Presenting the target as `plan_restricted`
    // there would be a false, overly specific claim. Any OTHER (non-429)
    // detail-fetch failure keeps the original search-time
    // `selection_reason` unchanged (unrelated to this correction).
    const reason = classifyDetailFailure({ selectionReason: selection_reason, detailError: detailResult.error });

    return {
      input_name: inputName,
      status: reason || "provider_error",
      selection_reason: reason || selection_reason,
      candidate_count: rawCandidates.length,
      error: { provider: "perenual", status: "error", http_status: detailResult.status ?? null, message: detailResult.error, retrieved_at: retrievedAt },
      record: baseRecord,
      candidates: auditedCandidates,
      traits: {},
    };
  }

  const sourceUrl = `${BASE}/species/details/${candidate.id}`;
  const { traits, cultivarField, varietyField, subspeciesField, hybridField } = mapPerenualDetailToTraits({
    candidateId: candidate.id,
    sourceUrl,
    detailData: detailResult.data,
    retrievedAt,
  });

  return {
    input_name: inputName,
    status: "ok",
    selection_reason,
    candidate_count: rawCandidates.length,
    error: null,
    candidates: auditedCandidates,
    record: {
      ...baseRecord,
      cultivar_field: cultivarField,
      variety_field: varietyField,
      subspecies_field: subspeciesField,
      hybrid_field: hybridField,
      source_url: sourceUrl,
    },
    traits,
  };
}
