// WCVP provider — taxonomic identity only, never horticultural data
// (spec §5, §15-18).
//
// Access method: GBIF's public Species API, filtered to the GBIF-hosted
// copy of the "World Checklist of Vascular Plants" checklist dataset
// (structured data, official Kew-published dataset via GBIF — not a POWO
// HTML scrape). datasetKey confirmed via GBIF's dataset registry:
// https://www.gbif.org/dataset/f382f0ce-323a-4091-bb9f-add557f3a9a2
//
// Matching strategy (spec §15/§17): the full-text `/species/search` call
// against the WCVP dataset is treated as a candidate LIST, never a single
// silent `results[0]` pick. Every result is scored through the same
// `selectCandidate` logic shared with the other two providers — exact
// name match first, parent/infraspecific compatible second, anything else
// is `ambiguous` rather than a guess.
//
// Synonym resolution (spec §16): the record actually matched by the query
// (`queried_usage`) is never presented as if it were the accepted name. If
// it is a synonym, its `acceptedKey` is followed with a second GBIF call to
// resolve the real `accepted_usage` record.
//
// IMPORTANT CAVEAT (read before trusting results): outbound network access
// to api.gbif.org is blocked by this environment's egress policy (verified
// directly — see README "Limites connues de l'exécution"). The exact GBIF
// response field names used below (canonicalName, taxonomicStatus, rank,
// acceptedKey, ...) come from GBIF's published Species API documentation,
// NOT from a live response inspected during this implementation.
// Re-validate this mapping against a real response before trusting any
// downstream coverage numbers.

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { parseCultivarName } from "../taxonomyMatch.js";
import { selectCandidate } from "../candidateSelection.js";

const WCVP_DATASET_KEY = "f382f0ce-323a-4091-bb9f-add557f3a9a2";
const GBIF_BASE = "https://api.gbif.org/v1";

function buildSearchUrl(name) {
  const u = new URL(`${GBIF_BASE}/species/search`);
  u.searchParams.set("datasetKey", WCVP_DATASET_KEY);
  u.searchParams.set("q", name);
  u.searchParams.set("limit", "10");
  return u.toString();
}

// Pure — converts one raw GBIF species record into our usage shape. Never
// mutates or drops the original raw_name.
export function usageFromRaw(raw) {
  return {
    raw_name: raw.canonicalName || raw.scientificName || null,
    canonical_name: raw.canonicalName ?? null,
    taxonomic_status: raw.taxonomicStatus ?? null,
    taxonomic_rank: raw.rank ?? null,
    family: raw.family ?? null,
    genus: raw.genus ?? null,
    species: raw.species ?? null,
    infraspecific_name: raw.infraspecificEpithet ?? null,
    taxon_id: raw.key != null ? String(raw.key) : null,
  };
}

// Pure — spec §16: the flattened `taxonomy` view used by the CSV/report
// layer always reflects the resolved ACCEPTED usage, never a synonym
// presented as if it were accepted. Safe to unit test with fixture usage
// objects, no network involved.
export function buildTaxonomyView({ queriedUsage, acceptedUsage, synonyms = [] }) {
  return {
    canonical_name: acceptedUsage ? acceptedUsage.canonical_name : null,
    accepted_name: acceptedUsage ? acceptedUsage.canonical_name : null,
    taxonomic_status: acceptedUsage ? acceptedUsage.taxonomic_status : (queriedUsage ? queriedUsage.taxonomic_status : null),
    taxonomic_rank: acceptedUsage ? acceptedUsage.taxonomic_rank : null,
    family: acceptedUsage ? acceptedUsage.family : null,
    genus: acceptedUsage ? acceptedUsage.genus : null,
    species: acceptedUsage ? acceptedUsage.species : null,
    infraspecific_name: acceptedUsage ? acceptedUsage.infraspecific_name : null,
    accepted_taxon_id: acceptedUsage ? acceptedUsage.taxon_id : null,
    source_taxon_id: queriedUsage ? queriedUsage.taxon_id : null,
    synonyms,
  };
}

export async function queryWcvp({ inputName, rawRoot }) {
  // Cultivars are queried on their botanical parent only — WCVP is not
  // expected, and must not be forced, to know a cultivar epithet (spec
  // §5/§18). This function never creates an artificial WCVP taxon for a
  // cultivar name.
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
      not_found: false,
      selection_reason: "provider_error",
      queried_usage: null,
      accepted_usage: null,
      taxonomy: null,
      candidates: [],
      error: {
        provider: "wcvp",
        status: "error",
        http_status: result.status ?? null,
        message: result.error,
        retrieved_at: retrievedAt,
      },
    };
  }

  const rawResults = (result.data && result.data.results) || [];
  const candidateInputs = rawResults.map((r) => ({ id: r.key, rawName: r.canonicalName || r.scientificName || "", raw: r }));

  // WCVP is always queried on the botanical parent — never pass the
  // cultivar epithet into the selection logic here (there is nothing in
  // WCVP that could legitimately match it).
  const { selected, selection_reason, candidates } = selectCandidate({
    parentName: queryName,
    cultivarName: null,
    candidates: candidateInputs,
  });

  const auditedCandidates = candidates.slice(0, 5).map((c) => ({
    id: c.id,
    name: c.rawName,
    normalized_comparison_name: c.normalized_comparison_name,
    score: c.score,
    reason: c.reason,
  }));

  if (!selected) {
    return {
      input_name: inputName,
      taxonomic_parent: parentName,
      cultivar_name: cultivarName,
      not_found: true,
      selection_reason: "not_found",
      queried_usage: null,
      accepted_usage: null,
      taxonomy: null,
      candidates: auditedCandidates,
      error: null,
    };
  }

  const raw = selected.raw;
  const queriedUsage = usageFromRaw(raw);
  const isSynonym = /synonym/i.test(raw.taxonomicStatus || "");

  let acceptedUsage = null;
  if (isSynonym && raw.acceptedKey) {
    const acceptedUrl = `${GBIF_BASE}/species/${raw.acceptedKey}`;
    const acceptedResult = await fetchJson(acceptedUrl, { providerName: "wcvp" });
    writeRaw(rawRoot, "wcvp", `${slug}.accepted`, { request_url: acceptedUrl, result: acceptedResult });
    if (acceptedResult.ok && acceptedResult.data) {
      acceptedUsage = usageFromRaw(acceptedResult.data);
    }
  } else if (!isSynonym) {
    // The queried usage IS the accepted usage — no separate call needed.
    acceptedUsage = queriedUsage;
  }

  // Synonyms of the resolved ACCEPTED taxon (not of the queried usage) are
  // what a horticultural provider's own "accepted" name should be compared
  // against downstream.
  let synonyms = [];
  const synonymsSourceKey = isSynonym ? raw.acceptedKey : raw.key;
  if (synonymsSourceKey) {
    const synUrl = `${GBIF_BASE}/species/${synonymsSourceKey}/synonyms?limit=20`;
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
    selection_reason,
    error: null,
    queried_usage: queriedUsage,
    accepted_usage: acceptedUsage,
    candidates: auditedCandidates,
    taxonomy: buildTaxonomyView({ queriedUsage, acceptedUsage, synonyms }),
  };
}
