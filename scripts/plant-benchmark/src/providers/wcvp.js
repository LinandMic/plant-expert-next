// WCVP provider — taxonomic identity only, never horticultural data
// (spec §5).
//
// Access method: GBIF's public Species API, filtered to the GBIF-hosted
// copy of the "World Checklist of Vascular Plants" checklist dataset
// (structured data, official Kew-published dataset via GBIF — not a POWO
// HTML scrape, per spec §5). datasetKey confirmed via GBIF's dataset
// registry: https://www.gbif.org/dataset/f382f0ce-323a-4091-bb9f-add557f3a9a2
//
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to api.gbif.org is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). The exact GBIF
// response field names used below (canonicalName, taxonomicStatus, rank,
// acceptedKey, ...) come from GBIF's published Species API documentation
// and data-blog examples, NOT from a live response inspected during this
// implementation. Re-validate this mapping against a real response (e.g.
// by running `raw/wcvp/*.json` through a diff) before trusting any
// downstream coverage numbers.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { parseCultivarName } from "../taxonomyMatch.js";

const WCVP_DATASET_KEY = "f382f0ce-323a-4091-bb9f-add557f3a9a2";
const GBIF_BASE = "https://api.gbif.org/v1";

function buildSearchUrl(name) {
  const u = new URL(`${GBIF_BASE}/species/search`);
  u.searchParams.set("datasetKey", WCVP_DATASET_KEY);
  u.searchParams.set("q", name);
  u.searchParams.set("limit", "5");
  return u.toString();
}

function pickBestResult(results, queryName) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const normalizedQuery = queryName.trim().toLowerCase();
  const exact = results.find(
    (r) => ((r.canonicalName || r.scientificName || "").trim().toLowerCase()) === normalizedQuery
  );
  return exact || results[0];
}

export async function queryWcvp({ inputName, rawRoot }) {
  // Cultivars are queried on their botanical parent only — WCVP is not
  // expected, and must not be forced, to know a cultivar epithet (spec §5).
  const { parentName, cultivarName } = parseCultivarName(inputName);
  const queryName = parentName;
  const retrievedAt = new Date().toISOString();
  const slug = slugify(inputName);

  const url = buildSearchUrl(queryName);
  const result = await fetchJson(url, { providerName: "wcvp" });
  writeRaw(rawRoot, "wcvp", slug, { input_name: inputName, query_name: queryName, request_url: url, result });

  if (!result.ok) {
    return {
      input_name: inputName,
      taxonomic_parent: parentName,
      cultivar_name: cultivarName,
      taxonomy: null,
      not_found: false,
      error: {
        provider: "wcvp",
        status: "error",
        http_status: result.status ?? null,
        message: result.error,
        retrieved_at: retrievedAt,
      },
    };
  }

  const best = pickBestResult(result.data && result.data.results, queryName);
  if (!best) {
    return {
      input_name: inputName,
      taxonomic_parent: parentName,
      cultivar_name: cultivarName,
      taxonomy: null,
      not_found: true,
      error: null,
    };
  }

  let synonyms = [];
  if (/accepted/i.test(best.taxonomicStatus || "")) {
    const synUrl = `${GBIF_BASE}/species/${best.key}/synonyms?limit=20`;
    const synResult = await fetchJson(synUrl, { providerName: "wcvp" });
    writeRaw(rawRoot, "wcvp", `${slug}.synonyms`, { request_url: synUrl, result: synResult });
    if (synResult.ok && Array.isArray(synResult.data && synResult.data.results)) {
      synonyms = synResult.data.results.map((s) => s.canonicalName || s.scientificName).filter(Boolean);
    }
  }

  return {
    input_name: inputName,
    taxonomic_parent: parentName,
    cultivar_name: cultivarName,
    not_found: false,
    error: null,
    taxonomy: {
      canonical_name: best.canonicalName ?? null,
      accepted_name: best.accepted ?? best.canonicalName ?? null,
      taxonomic_status: best.taxonomicStatus ?? null,
      taxonomic_rank: best.rank ?? null,
      family: best.family ?? null,
      genus: best.genus ?? null,
      species: best.species ?? null,
      infraspecific_name: best.infraspecificEpithet ?? null,
      accepted_taxon_id: best.acceptedKey != null ? String(best.acceptedKey) : (best.key != null ? String(best.key) : null),
      source_taxon_id: best.key != null ? String(best.key) : null,
      synonyms,
    },
  };
}
