// Trefle provider — structured plant traits, provider aggregates several
// upstream sources per field (spec §7).
//
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to trefle.io is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). Field paths
// below (growth.*, sources[].*) reflect the last publicly documented Trefle
// response shape, NOT a live response inspected during this
// implementation. Re-validate against `raw/trefle/*.detail.json` from a
// real run before trusting any coverage numbers.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation } from "../normalize.js";

const BASE = "https://trefle.io/api/v1";

export async function queryTrefle({ inputName, rawRoot, apiKey }) {
  const slug = slugify(inputName);
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return { input_name: inputName, status: "skipped_no_key", error: null, record: null, provenance: null, traits: {} };
  }

  const searchUrl = `${BASE}/plants/search?token=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(inputName)}`;
  const searchResult = await fetchJson(searchUrl, { providerName: "trefle" });
  writeRaw(rawRoot, "trefle", `${slug}.search`, { input_name: inputName, result: searchResult });

  if (!searchResult.ok) {
    return {
      input_name: inputName,
      status: "error",
      error: { provider: "trefle", status: "error", http_status: searchResult.status ?? null, message: searchResult.error, retrieved_at: retrievedAt },
      record: null,
      provenance: null,
      traits: {},
    };
  }

  const candidates = (searchResult.data && searchResult.data.data) || [];
  if (candidates.length === 0) {
    return { input_name: inputName, status: "not_found", error: null, record: null, provenance: null, traits: {} };
  }
  const candidate = candidates[0];

  const detailUrl = `${BASE}/species/${candidate.id}?token=${encodeURIComponent(apiKey)}`;
  const detailResult = await fetchJson(detailUrl, { providerName: "trefle" });
  writeRaw(rawRoot, "trefle", `${slug}.detail`, { input_name: inputName, result: detailResult });

  const baseRecord = {
    id: candidate.id ?? null,
    provider_name: candidate.common_name ?? null,
    scientific_name: candidate.scientific_name ?? null,
    family: candidate.family ?? null,
    genus: candidate.genus ?? null,
  };

  if (!detailResult.ok) {
    return {
      input_name: inputName,
      status: "error",
      candidate_count: candidates.length,
      error: { provider: "trefle", status: "error", http_status: detailResult.status ?? null, message: detailResult.error, retrieved_at: retrievedAt },
      record: baseRecord,
      provenance: null,
      traits: {},
    };
  }

  const species = (detailResult.data && detailResult.data.data) || {};
  const growth = species.growth || {};
  const sources = Array.isArray(species.sources) ? species.sources : [];
  const primarySource = sources[0] || null;
  const sourceUrl = `${BASE}/species/${candidate.id}`;

  // Provenance is preserved per-plant here (spec §7: never collapse
  // "trait + several sources" down to "trait = Trefle" when the response
  // actually names an upstream source).
  const provenance = {
    upstream_source: primarySource ? (primarySource.name ?? null) : null,
    source_record_id: candidate.id != null ? String(candidate.id) : null,
    source_url: primarySource ? (primarySource.url ?? sourceUrl) : sourceUrl,
    license: primarySource ? (primarySource.license ?? null) : null,
    attribution: primarySource ? (primarySource.citation ?? null) : null,
    all_sources: sources,
  };

  const traits = {};
  function add(trait, rawValue, normalizedValue, unit) {
    if (rawValue === undefined || rawValue === null) return;
    pushObservation(traits, trait, makeObservation({
      provider: "trefle",
      rawValue,
      normalizedValue: normalizedValue === undefined ? rawValue : normalizedValue,
      normalizedUnit: unit ?? null,
      sourceRecordId: provenance.source_record_id,
      sourceUrl: provenance.source_url,
      license: provenance.license,
      attribution: provenance.attribution,
      retrievedAt,
    }));
  }

  add("height_max_cm", growth.maximum_height && growth.maximum_height.cm, growth.maximum_height && growth.maximum_height.cm, "cm");
  add("height_min_cm", growth.minimum_height && growth.minimum_height.cm, growth.minimum_height && growth.minimum_height.cm, "cm");
  add("sun", growth.light);
  add("soil_ph_min", growth.ph_minimum);
  add("soil_ph_max", growth.ph_maximum);
  add("soil_moisture", growth.atmospheric_humidity);
  add(
    "min_temperature_c",
    growth.minimum_temperature && growth.minimum_temperature.deg_c,
    growth.minimum_temperature && growth.minimum_temperature.deg_c,
    "c"
  );
  add(
    "max_temperature_c",
    growth.maximum_temperature && growth.maximum_temperature.deg_c,
    growth.maximum_temperature && growth.maximum_temperature.deg_c,
    "c"
  );
  add("growth_rate", growth.growth_rate);
  add("drought_tolerance", growth.drought_tolerance);
  add(
    "water_need",
    growth.minimum_precipitation && growth.minimum_precipitation.mm,
    growth.minimum_precipitation && growth.minimum_precipitation.mm,
    "mm"
  );

  return {
    input_name: inputName,
    status: "ok",
    candidate_count: candidates.length,
    error: null,
    record: { ...baseRecord, source_url: sourceUrl },
    provenance,
    traits,
  };
}
