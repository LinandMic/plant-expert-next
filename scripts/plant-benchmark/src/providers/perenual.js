// Perenual provider — horticultural traits and cultivar identification
// (spec §6).
//
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to perenual.com is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). Every field
// access below is defensive (`?? null`) precisely BECAUSE the exact current
// response shape was not inspected live in this environment, per spec §6
// ("inspecte réellement les réponses JSON"). Re-run this provider with real
// network access and a real key, then diff `raw/perenual/*.detail.json`
// against this mapping before trusting any coverage numbers it produces.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { makeObservation, pushObservation } from "../normalize.js";

const BASE = "https://perenual.com/api/v2";

export async function queryPerenual({ inputName, rawRoot, apiKey }) {
  const slug = slugify(inputName);
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return { input_name: inputName, status: "skipped_no_key", error: null, record: null, traits: {} };
  }

  const searchUrl = `${BASE}/species-list?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(inputName)}`;
  const searchResult = await fetchJson(searchUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.search`, { input_name: inputName, result: searchResult });

  if (!searchResult.ok) {
    return {
      input_name: inputName,
      status: "error",
      error: { provider: "perenual", status: "error", http_status: searchResult.status ?? null, message: searchResult.error, retrieved_at: retrievedAt },
      record: null,
      traits: {},
    };
  }

  const candidates = (searchResult.data && searchResult.data.data) || [];
  if (candidates.length === 0) {
    return { input_name: inputName, status: "not_found", error: null, record: null, traits: {} };
  }
  const candidate = candidates[0];

  const detailUrl = `${BASE}/species/details/${candidate.id}?key=${encodeURIComponent(apiKey)}`;
  const detailResult = await fetchJson(detailUrl, { providerName: "perenual" });
  writeRaw(rawRoot, "perenual", `${slug}.detail`, { input_name: inputName, result: detailResult });

  const baseRecord = {
    id: candidate.id ?? null,
    provider_name: candidate.common_name ?? null,
    scientific_name: Array.isArray(candidate.scientific_name) ? candidate.scientific_name[0] ?? null : (candidate.scientific_name ?? null),
    other_name: candidate.other_name ?? null,
  };

  if (!detailResult.ok) {
    return {
      input_name: inputName,
      status: "error",
      candidate_count: candidates.length,
      error: { provider: "perenual", status: "error", http_status: detailResult.status ?? null, message: detailResult.error, retrieved_at: retrievedAt },
      record: baseRecord,
      traits: {},
    };
  }

  const d = detailResult.data || {};
  const sourceUrl = `${BASE}/species/details/${candidate.id}`;
  const traits = {};

  function add(trait, rawValue, normalizedValue, opts = {}) {
    if (rawValue === undefined || rawValue === null) return;
    pushObservation(traits, trait, makeObservation({
      provider: "perenual",
      rawValue,
      normalizedValue: normalizedValue === undefined ? rawValue : normalizedValue,
      sourceRecordId: candidate.id != null ? String(candidate.id) : null,
      sourceUrl,
      retrievedAt,
      ...opts,
    }));
  }

  add("water_need", d.watering);
  add("sun", d.sunlight);
  add("drought_tolerance", d.drought_tolerant);
  add("growth_rate", d.growth_rate);
  add("container_suitable", d.container ?? d.indoor);
  if (d.cycle !== undefined && d.cycle !== null) {
    const evergreen = /evergreen/i.test(String(d.cycle)) ? true : (/deciduous/i.test(String(d.cycle)) ? false : null);
    add("evergreen", d.cycle, evergreen, { uncertain: evergreen === null });
  }
  if (d.edible_fruit !== undefined || d.edible_leaf !== undefined) {
    add("edible", { edible_fruit: d.edible_fruit ?? null, edible_leaf: d.edible_leaf ?? null }, Boolean(d.edible_fruit || d.edible_leaf));
  }
  if (d.flowering_season !== undefined && d.flowering_season !== null) {
    add("flowering_months", d.flowering_season, null, { uncertain: true });
  }
  if (d.dimensions && typeof d.dimensions.max === "number") {
    const isCm = /cm/i.test(d.dimensions.unit || "");
    add("height_max_cm", d.dimensions.max, isCm ? d.dimensions.max : null, {
      rawUnit: d.dimensions.unit ?? null,
      normalizedUnit: isCm ? "cm" : null,
      uncertain: !isCm,
    });
  }

  const cultivarField = d.cultivar ?? d.variety ?? d.subspecies ?? null;

  return {
    input_name: inputName,
    status: "ok",
    candidate_count: candidates.length,
    error: null,
    record: {
      ...baseRecord,
      cultivar_field: cultivarField,
      hybrid_field: d.hybrid ?? null,
      source_url: sourceUrl,
    },
    traits,
  };
}
