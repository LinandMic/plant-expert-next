// Trefle provider — structured plant traits (spec §6-14).
//
// Corrections applied in this revision:
//  - soil_moisture now comes from growth.soil_humidity, NEVER
//    atmospheric_humidity (spec §6) — the two are kept as separate traits.
//  - precipitation is never mapped to water_need (spec §7) — it becomes
//    minimum_precipitation_mm_year / maximum_precipitation_mm_year, and
//    water_need is left unmapped for Trefle entirely.
//  - height/spread that appear in more than one response block
//    (growth.* vs specifications.*) are kept as separate observations
//    under the same trait, tagged with `field_path`, never silently
//    collapsed (spec §9).
//  - provenance is recorded at record scope, never attributed to a
//    specific trait unless the response genuinely ties a source to that
//    trait (spec §10) — Trefle's documented `sources` array is per-record,
//    so no per-observation license/attribution is set here.
//  - candidate selection goes through the same shared, documented,
//    non-`candidates[0]` logic as the other providers (spec §11/§12).
//
// The trait-mapping logic is a pure function (`mapTrefleDetailToTraits`)
// deliberately separated from the network call, so it can be unit tested
// with small fixture objects — see
// scripts/plant-benchmark/test/trefle.test.js.
//
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to trefle.io is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). Field paths
// below reflect the last publicly documented Trefle response shape, NOT a
// live response inspected during this implementation. Re-validate against
// `raw/trefle/*.detail.json` from a real run before trusting any coverage
// numbers.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation } from "../normalize.js";
import { selectCandidate } from "../candidateSelection.js";

const BASE = "https://trefle.io/api/v1";

/**
 * mapTrefleDetailToTraits — pure. Given a `species/{id}` payload's `data`
 * object, returns { traits, provenance }. No network, no side effects —
 * safe to unit test with a tiny fixture object.
 */
export function mapTrefleDetailToTraits({ candidateId, sourceUrl, detailData, retrievedAt }) {
  const species = detailData || {};
  const growth = species.growth || {};
  const specifications = species.specifications || {};
  const foliage = species.foliage || {};
  const sources = Array.isArray(species.sources) ? species.sources : [];

  // Spec §10: record-scope provenance only — Trefle's `sources` array is
  // documented at the record level, not per trait. No observation below
  // is ever attributed to a specific named source unless the response
  // genuinely ties one to it (it does not, in the documented shape).
  const provenance = {
    provider: "trefle",
    record_sources: sources,
    source_scope: "record",
  };

  const traits = {};
  function add(trait, fieldPath, rawValue, normalizedValue, unit) {
    if (rawValue === undefined || rawValue === null) return;
    pushObservation(traits, trait, makeObservation({
      provider: "trefle",
      fieldPath,
      rawValue,
      normalizedValue: normalizedValue === undefined ? rawValue : normalizedValue,
      normalizedUnit: unit ?? null,
      sourceRecordId: candidateId != null ? String(candidateId) : null,
      sourceUrl,
      // license/attribution deliberately left null on the observation —
      // see provenance.record_sources for what is actually known.
      retrievedAt,
    }));
  }

  // --- height/spread: growth.* and specifications.* kept as SEPARATE
  // observations of the same trait, never silently merged (spec §9).
  const growthMaxHeightCm = growth.maximum_height && typeof growth.maximum_height.cm === "number" ? growth.maximum_height.cm : null;
  add("height_max_cm", "growth.maximum_height", growth.maximum_height && growth.maximum_height.cm, growthMaxHeightCm, "cm");
  const growthMinHeightCm = growth.minimum_height && typeof growth.minimum_height.cm === "number" ? growth.minimum_height.cm : null;
  add("height_min_cm", "growth.minimum_height", growth.minimum_height && growth.minimum_height.cm, growthMinHeightCm, "cm");

  if (specifications.maximum_height !== undefined && specifications.maximum_height !== null) {
    // specifications.maximum_height's unit is not reliably documented as
    // always-cm — convert only if it already looks like a plain number in
    // cm per Trefle's spec pages; otherwise keep raw with normalized=null
    // rather than assume a unit that was never confirmed live.
    add("height_max_cm", "specifications.maximum_height", specifications.maximum_height, null, null);
  }

  if (growth.spread && typeof growth.spread.cm === "number") {
    add("spread_max_cm", "growth.spread", growth.spread.cm, growth.spread.cm, "cm");
  }

  add("growth_form", "specifications.growth_form", specifications.growth_form, specifications.growth_form);
  add("sun", "growth.light", growth.light, growth.light);

  // --- Spec §6: soil_moisture <- growth.soil_humidity ONLY. Never
  // atmospheric_humidity. atmospheric_humidity kept as its own distinct
  // trait when present.
  add("soil_moisture", "growth.soil_humidity", growth.soil_humidity, growth.soil_humidity);
  add("atmospheric_humidity", "growth.atmospheric_humidity", growth.atmospheric_humidity, growth.atmospheric_humidity);

  add("soil_texture", "growth.soil_texture", growth.soil_texture, growth.soil_texture);
  add("soil_ph_min", "growth.ph_minimum", growth.ph_minimum, growth.ph_minimum);
  add("soil_ph_max", "growth.ph_maximum", growth.ph_maximum, growth.ph_maximum);

  const minTempC = growth.minimum_temperature && typeof growth.minimum_temperature.deg_c === "number" ? growth.minimum_temperature.deg_c : null;
  add("min_temperature_c", "growth.minimum_temperature", growth.minimum_temperature && growth.minimum_temperature.deg_c, minTempC, "c");
  const maxTempC = growth.maximum_temperature && typeof growth.maximum_temperature.deg_c === "number" ? growth.maximum_temperature.deg_c : null;
  add("max_temperature_c", "growth.maximum_temperature", growth.maximum_temperature && growth.maximum_temperature.deg_c, maxTempC, "c");

  // --- Spec §7: precipitation gets its OWN trait names, never water_need.
  const minPrecipMm = growth.minimum_precipitation && typeof growth.minimum_precipitation.mm === "number" ? growth.minimum_precipitation.mm : null;
  add("minimum_precipitation_mm_year", "growth.minimum_precipitation", growth.minimum_precipitation && growth.minimum_precipitation.mm, minPrecipMm, "mm");
  const maxPrecipMm = growth.maximum_precipitation && typeof growth.maximum_precipitation.mm === "number" ? growth.maximum_precipitation.mm : null;
  add("maximum_precipitation_mm_year", "growth.maximum_precipitation", growth.maximum_precipitation && growth.maximum_precipitation.mm, maxPrecipMm, "mm");
  // water_need intentionally never populated from Trefle data.

  add("growth_rate", "growth.growth_rate", growth.growth_rate, growth.growth_rate);
  add("drought_tolerance", "growth.drought_tolerance", growth.drought_tolerance, growth.drought_tolerance);
  add("flowering_months", "growth.bloom_months", growth.bloom_months, null, null);
  add("evergreen", "foliage.leaf_retention", foliage.leaf_retention, foliage.leaf_retention);

  return { traits, provenance };
}

export async function queryTrefle({ inputName, rawRoot, apiKey }) {
  const slug = slugify(inputName);
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return { input_name: inputName, status: "skipped_no_key", selection_reason: "skipped_no_key", error: null, record: null, candidates: [], provenance: null, traits: {} };
  }

  const searchUrl = `${BASE}/plants/search?token=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(inputName)}`;
  const searchResult = await fetchJson(searchUrl, { providerName: "trefle" });
  writeRaw(rawRoot, "trefle", `${slug}.search`, { input_name: inputName, result: searchResult });

  if (!searchResult.ok) {
    return {
      input_name: inputName,
      status: "provider_error",
      selection_reason: "provider_error",
      error: { provider: "trefle", status: "error", http_status: searchResult.status ?? null, message: searchResult.error, retrieved_at: retrievedAt },
      record: null,
      candidates: [],
      provenance: null,
      traits: {},
    };
  }

  const rawCandidates = (searchResult.data && searchResult.data.data) || [];

  const cultivarMatch = /^(.*?)\s*'([^']+)'\s*$/.exec(inputName.trim());
  const parentName = cultivarMatch ? cultivarMatch[1].trim() : inputName.trim();
  const cultivarName = cultivarMatch ? cultivarMatch[2].trim() : null;

  const candidateInputs = rawCandidates.map((c) => ({ id: c.id, rawName: c.scientific_name ?? "", raw: c }));
  const { selected, selection_reason, candidates } = selectCandidate({ parentName, cultivarName, candidates: candidateInputs });
  const auditedCandidates = candidates.slice(0, 5).map((c) => ({ id: c.id, name: c.rawName, score: c.score, reason: c.reason }));

  if (!selected) {
    return { input_name: inputName, status: "not_found", selection_reason: "not_found", error: null, record: null, candidates: auditedCandidates, provenance: null, traits: {} };
  }

  const candidate = selected.raw;
  const baseRecord = {
    id: candidate.id ?? null,
    provider_name: candidate.common_name ?? null,
    scientific_name: selected.rawName || null,
    family: candidate.family ?? null,
    genus: candidate.genus ?? null,
  };

  const detailUrl = `${BASE}/species/${candidate.id}?token=${encodeURIComponent(apiKey)}`;
  const detailResult = await fetchJson(detailUrl, { providerName: "trefle" });
  writeRaw(rawRoot, "trefle", `${slug}.detail`, { input_name: inputName, result: detailResult });

  if (!detailResult.ok) {
    return {
      input_name: inputName,
      status: "provider_error",
      selection_reason,
      candidate_count: rawCandidates.length,
      error: { provider: "trefle", status: "error", http_status: detailResult.status ?? null, message: detailResult.error, retrieved_at: retrievedAt },
      record: baseRecord,
      candidates: auditedCandidates,
      provenance: null,
      traits: {},
    };
  }

  const sourceUrl = `${BASE}/species/${candidate.id}`;
  const species = (detailResult.data && detailResult.data.data) || {};
  const { traits, provenance } = mapTrefleDetailToTraits({ candidateId: candidate.id, sourceUrl, detailData: species, retrievedAt });

  return {
    input_name: inputName,
    status: "ok",
    selection_reason,
    candidate_count: rawCandidates.length,
    error: null,
    candidates: auditedCandidates,
    record: { ...baseRecord, source_url: sourceUrl },
    provenance,
    traits,
  };
}
