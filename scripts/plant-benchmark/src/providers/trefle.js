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
// FURTHER CORRECTIONS applied after testing the REAL API from a normal
// network environment (a real `species/{id}` response for Acer palmatum):
//  - `specifications.maximum_height`/`average_height` are objects with a
//    `.cm` sub-field (`{ cm: null }`), never a bare number — reading the
//    object itself as the raw value was a bug; `.cm` is now read
//    explicitly and a `null` `.cm` is never turned into `0`.
//    `specifications.average_height.cm` is now also mapped, to its own
//    `height_avg_cm` trait (neither a min nor a max, so it is never forced
//    into `height_min_cm`/`height_max_cm`).
//  - `growth_rate` actually lives at `specifications.growth_rate`, not
//    `growth.growth_rate` — the specifications path is now primary;
//    `growth.growth_rate` is kept only as an explicitly documented
//    fallback for an older/unconfirmed shape, used ONLY when
//    `specifications.growth_rate` is itself absent, never overwriting it.
//  - `growth.light` is a numeric 0-10 scale, not a sun-exposure category —
//    it is kept under its own unambiguous name (`light_0_10`) and never
//    auto-translated into "full sun"/"part shade"/"shade"; it no longer
//    feeds the `sun` trait until a validated crosswalk exists.
//  - `growth.bloom_months` is an array of documented 3-letter lowercase
//    month codes (e.g. `["apr","may"]`) — these are now deterministically
//    normalized to canonical month numbers (`[4,5]`) via a fixed
//    whitelist, never left as `null` when the codes are genuinely
//    recognized, and never a seasonal inference of any kind. An
//    unrecognized code anywhere in the array leaves the whole
//    normalization `null` (raw_value always kept) rather than guessing.
//
// The trait-mapping logic is a pure function (`mapTrefleDetailToTraits`)
// deliberately separated from the network call, so it can be unit tested
// with small fixture objects — see
// scripts/plant-benchmark/test/trefle.test.js.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation } from "../normalize.js";
import { selectCandidate } from "../candidateSelection.js";

const BASE = "https://trefle.io/api/v1";

// Trefle's documented 3-letter lowercase month codes -> canonical month
// number (1-12). Deterministic whitelist only — never a seasonal
// inference (spec: "Pas d'inférence saisonnière").
const MONTH_CODE_TO_NUMBER = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * normalizeMonthCodes — pure. Converts a raw `growth.bloom_months` array
 * (e.g. `["apr","may"]`) into canonical month numbers (`[4,5]`). Returns
 * `null` (never a partial/guessed result) if the input isn't a non-empty
 * array, or if ANY code in it isn't a recognized month abbreviation —
 * raw_value is always preserved regardless by the caller.
 */
export function normalizeMonthCodes(rawMonths) {
  if (!Array.isArray(rawMonths) || rawMonths.length === 0) return null;
  const numbers = [];
  for (const code of rawMonths) {
    const num = MONTH_CODE_TO_NUMBER[String(code || "").trim().toLowerCase()];
    if (num === undefined) return null;
    numbers.push(num);
  }
  return numbers;
}

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

  // Corrected: specifications.maximum_height/average_height are objects
  // with a `.cm` sub-field (verified live: `{ cm: null }`), never a bare
  // number — read `.cm` explicitly, and only add an observation when it is
  // genuinely a number (a `null` `.cm` is never turned into `0`, and never
  // silently added as a fabricated "empty" observation either).
  if (specifications.maximum_height && typeof specifications.maximum_height.cm === "number") {
    add("height_max_cm", "specifications.maximum_height", specifications.maximum_height.cm, specifications.maximum_height.cm, "cm");
  }
  if (specifications.average_height && typeof specifications.average_height.cm === "number") {
    // Neither a min nor a max — its own trait, never forced into
    // height_min_cm/height_max_cm.
    add("height_avg_cm", "specifications.average_height", specifications.average_height.cm, specifications.average_height.cm, "cm");
  }

  if (growth.spread && typeof growth.spread.cm === "number") {
    add("spread_max_cm", "growth.spread", growth.spread.cm, growth.spread.cm, "cm");
  }

  add("growth_form", "specifications.growth_form", specifications.growth_form, specifications.growth_form);

  // Corrected: growth.light is a numeric 0-10 scale (verified live:
  // `growth.light = 7`), NOT a sun-exposure category — never auto-convert
  // it to "full sun"/"part shade"/"shade". Kept under its own unambiguous
  // name; it does not feed `sun` until a validated crosswalk exists (it
  // may surface under extra_discovered_traits instead).
  add("light_0_10", "growth.light", growth.light, growth.light);

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

  // Corrected: growth_rate actually lives at specifications.growth_rate
  // (verified live), not growth.growth_rate. specifications is now the
  // primary source; growth.growth_rate is an explicitly documented
  // fallback for an older/unconfirmed shape, used ONLY when
  // specifications.growth_rate is itself absent — it never overwrites or
  // duplicates the specifications-path value.
  if (specifications.growth_rate !== undefined && specifications.growth_rate !== null) {
    add("growth_rate", "specifications.growth_rate", specifications.growth_rate, specifications.growth_rate);
  } else if (growth.growth_rate !== undefined && growth.growth_rate !== null) {
    add("growth_rate", "growth.growth_rate", growth.growth_rate, growth.growth_rate);
  }
  add("drought_tolerance", "growth.drought_tolerance", growth.drought_tolerance, growth.drought_tolerance);
  add("flowering_months", "growth.bloom_months", growth.bloom_months, normalizeMonthCodes(growth.bloom_months), null);
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
