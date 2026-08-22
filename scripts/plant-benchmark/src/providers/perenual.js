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
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to perenual.com is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). Every field
// access below is defensive (`?? null`/`!== undefined`) precisely BECAUSE
// the exact current response shape was not inspected live in this
// environment. Re-run this provider with real network access and a real
// key, then diff `raw/perenual/*.detail.json` against this mapping before
// trusting any coverage numbers it produces.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation, convertToCm } from "../normalize.js";
import { selectCandidate } from "../candidateSelection.js";

const BASE = "https://perenual.com/api/v2";

export function extractDimensionCm(dimensions, key) {
  // Spec §2: use the documented `min_value`/`max_value`/`unit` shape, not
  // an undocumented `.min`/`.max`. Still fully defensive — this is only
  // read if the field genuinely exists on the response.
  if (!dimensions || typeof dimensions !== "object") return { raw: null, unit: null, cm: null };
  const raw = dimensions[key];
  const unit = dimensions.unit ?? null;
  if (raw === undefined || raw === null) return { raw: null, unit, cm: null };
  return { raw, unit, cm: convertToCm(typeof raw === "number" ? raw : Number(raw), unit) };
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
  add("growth_form", d.type);
  add("sun", d.sunlight);
  add("soil", d.soil);
  add("growth_rate", d.growth_rate);
  add("drought_tolerance", d.drought_tolerant);
  add("attracts", d.attracts);
  add("water_need", d.watering);
  add("container_suitable", d.container ?? d.indoor);
  if (d.hardiness && d.hardiness.min !== undefined) add("hardiness_min", d.hardiness.min);
  if (d.hardiness && d.hardiness.max !== undefined) add("hardiness_max", d.hardiness.max);
  if (d.flowering_season !== undefined && d.flowering_season !== null) {
    add("flowering_months", d.flowering_season, null, { uncertain: true });
  }

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

  // --- Spec §2: dimensions via the documented min_value/max_value/unit
  // shape, deterministic cm conversion only for supported units.
  if (d.dimensions) {
    const maxDim = extractDimensionCm(d.dimensions, "max_value");
    const minDim = extractDimensionCm(d.dimensions, "min_value");
    if (maxDim.raw !== null) {
      add("height_max_cm", maxDim.raw, maxDim.cm, { rawUnit: maxDim.unit, normalizedUnit: maxDim.cm !== null ? "cm" : null, uncertain: maxDim.cm === null });
    }
    if (minDim.raw !== null) {
      add("height_min_cm", minDim.raw, minDim.cm, { rawUnit: minDim.unit, normalizedUnit: minDim.cm !== null ? "cm" : null, uncertain: minDim.cm === null });
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

export async function queryPerenual({ inputName, rawRoot, apiKey }) {
  const slug = slugify(inputName);
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return { input_name: inputName, status: "skipped_no_key", selection_reason: "skipped_no_key", error: null, record: null, candidates: [], traits: {} };
  }

  const searchUrl = `${BASE}/species-list?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(inputName)}`;
  const searchResult = await fetchJson(searchUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.search`, { input_name: inputName, result: searchResult });

  if (!searchResult.ok) {
    return {
      input_name: inputName,
      status: "provider_error",
      selection_reason: "provider_error",
      error: { provider: "perenual", status: "error", http_status: searchResult.status ?? null, message: searchResult.error, retrieved_at: retrievedAt },
      record: null,
      candidates: [],
      traits: {},
    };
  }

  const rawCandidates = (searchResult.data && searchResult.data.data) || [];

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

  const detailUrl = `${BASE}/species/details/${candidate.id}?key=${encodeURIComponent(apiKey)}`;
  const detailResult = await fetchJson(detailUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.detail`, { input_name: inputName, result: detailResult });

  if (!detailResult.ok) {
    return {
      input_name: inputName,
      status: "provider_error",
      selection_reason,
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
