// WCVP provider — taxonomic identity only, never horticultural data
// (spec §5, §15-18).
//
// Access method: GBIF's public Species API, filtered to the GBIF-hosted
// copy of the "World Checklist of Vascular Plants" checklist dataset
// (structured data, official Kew-published dataset via GBIF — not a POWO
// HTML scrape). datasetKey confirmed via GBIF's dataset registry:
// https://www.gbif.org/dataset/f382f0ce-323a-4091-bb9f-add557f3a9a2
//
// Matching strategy, corrected after testing the REAL API from a normal
// network environment:
//  - the EXACT lookup (`GET /v1/species?datasetKey=...&name=...`) is now
//    the PRIMARY strategy — verified live to return a single precise
//    record (e.g. `Rosmarinus officinalis` -> one SYNONYM record with
//    taxonomicStatus/acceptedKey) rather than the long, loosely-ordered
//    list of sub-taxa/synonyms full-text search returns for the same
//    name.
//  - full-text `/species/search` is used ONLY as a fallback, when the
//    exact lookup itself doesn't yield a reliable resolution (zero
//    results, or its own candidates are ambiguous) — never as the first
//    attempt, and never a single silent `results[0]` pick either. Every
//    result from either endpoint is scored through the same
//    `selectCandidate` logic shared with the other two providers — exact
//    name match first, parent/infraspecific compatible second, anything
//    else is `ambiguous` rather than a guess.
//
// Synonym resolution (spec §16): the record actually matched by the query
// (`queried_usage`) is never presented as if it were the accepted name. If
// it is a synonym, its `acceptedKey` is followed with a second GBIF call to
// resolve the real `accepted_usage` record — this is exactly the shape
// verified live for Rosmarinus officinalis (key 207219419, SYNONYM,
// acceptedKey 207219357 — public GBIF/WCVP taxon identifiers, not
// secrets).

import { fetchJson } from "../httpClient.js";
import { writeRaw, slugify } from "../cache.js";
import { parseCultivarName } from "../taxonomyMatch.js";
import { selectCandidate } from "../candidateSelection.js";

function isAcceptedStatus(status) {
  return /^accepted$/i.test((status || "").trim());
}

function isSynonymStatus(status) {
  return /synonym/i.test(status || "");
}

const WCVP_DATASET_KEY = "f382f0ce-323a-4091-bb9f-add557f3a9a2";
const GBIF_BASE = "https://api.gbif.org/v1";

function buildExactLookupUrl(name) {
  const u = new URL(`${GBIF_BASE}/species`);
  u.searchParams.set("datasetKey", WCVP_DATASET_KEY);
  u.searchParams.set("name", name);
  return u.toString();
}

function buildSearchUrl(name) {
  const u = new URL(`${GBIF_BASE}/species/search`);
  u.searchParams.set("datasetKey", WCVP_DATASET_KEY);
  u.searchParams.set("q", name);
  u.searchParams.set("limit", "10");
  return u.toString();
}

// Pure — scores a raw GBIF results array against the query name through
// the same shared, documented, non-`results[0]` candidate logic used by
// every provider. Exported so the exact-lookup-first / full-text-fallback
// decision can be unit tested without any network call (spec §12/§13).
//
// Corrected: the shared `selectCandidate` scores multiple exact
// canonicalName matches as an unresolved tie at score 100 (it does not
// flag scores of exactly 100 as ambiguous — see candidateSelection.js) and
// falls back to whichever the API happened to list first. For WCVP this is
// wrong whenever the tied candidates are HOMONYMS with different
// taxonomicStatus — real case observed: two "Clematis montana" records,
// one SYNONYM (resolving to "Clematis napaulensis" via acceptedKey) and
// one ACCEPTED (staying "Clematis montana"); results[] order alone had
// been silently picking the SYNONYM. WCVP-specific tie-breaking:
//   - exactly one exact match -> unchanged (no tie to break).
//   - >1 exact match, exactly one is ACCEPTED -> that one wins, never the
//     SYNONYM, regardless of results[] order.
//   - >1 exact match, >1 ACCEPTED among them -> genuinely ambiguous
//     homonyms, `ambiguous`, never an arbitrary pick.
//   - >1 exact match, zero ACCEPTED, exactly one SYNONYM -> that SYNONYM
//     is selected (then resolved via acceptedKey as usual downstream).
//   - >1 exact match, zero ACCEPTED, and not exactly one SYNONYM either
//     (0 or several) -> not safely resolvable -> `ambiguous`.
export function scoreWcvpResults(rawResults, queryName) {
  const candidateInputs = (rawResults || []).map((r) => ({ id: r.key, rawName: r.canonicalName || r.scientificName || "", raw: r }));
  // WCVP is always queried on the botanical parent — never pass a
  // cultivar epithet into the selection logic here.
  const generic = selectCandidate({ parentName: queryName, cultivarName: null, candidates: candidateInputs });

  const exactTies = generic.candidates.filter((c) => c.score === 100 && c.reason === "exact_scientific_match");
  if (exactTies.length <= 1) return generic;

  const accepted = exactTies.filter((c) => isAcceptedStatus(c.raw && c.raw.taxonomicStatus));
  if (accepted.length === 1) {
    return { selected: accepted[0], selection_reason: "exact_scientific_match", candidates: generic.candidates };
  }
  if (accepted.length > 1) {
    // Multiple ACCEPTED homonyms — never guessed between them.
    return { selected: exactTies[0], selection_reason: "ambiguous", candidates: generic.candidates };
  }

  const synonyms = exactTies.filter((c) => isSynonymStatus(c.raw && c.raw.taxonomicStatus));
  if (synonyms.length === 1) {
    return { selected: synonyms[0], selection_reason: "exact_scientific_match", candidates: generic.candidates };
  }

  // No ACCEPTED, and not exactly one SYNONYM either — not safely
  // resolvable from name + status alone.
  return { selected: exactTies[0], selection_reason: "ambiguous", candidates: generic.candidates };
}

// Pure — the exact lookup is only worth falling back from when it found
// NOTHING at all. Corrected: it previously also fell back whenever the
// exact lookup itself was `ambiguous` (multiple tied exact usages) — but
// letting full-text search pick a winner in that case turned a REAL
// ambiguity into a run-to-run arbitrary choice (real case: querying
// "Pennisetum alopecuroides" resolved to a different exact SYNONYM across
// two separate runs, because each run's full-text ranking differed).
// Every candidate the exact-lookup endpoint returns is by definition an
// exact canonicalName match, so an `ambiguous` result from it always means
// "multiple tied exact usages, status alone doesn't resolve them" — never
// "no good candidates at all" — and must never be silently overridden by
// a full-text pick. Only a truly empty exact lookup falls back (spec:
// "ne pas passer ensuite silencieusement par le full-text fallback pour
// choisir l'un d'eux").
export function shouldFallbackToFullTextSearch(exactRawResults) {
  return (exactRawResults || []).length === 0;
}

// Pure — the single gate deciding whether a selection may ever be used to
// build a canonical taxonomy (queried_usage/accepted_usage/taxonomy). An
// `ambiguous` selection must NEVER produce one — see queryWcvp's ambiguous
// branch below, which returns null usages and a full audit candidate list
// instead of guessing.
export function canResolveTaxonomyFromSelection(selectionReason) {
  return selectionReason !== "ambiguous";
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

function auditCandidates(candidates) {
  return candidates.slice(0, 5).map((c) => ({
    id: c.id,
    name: c.rawName,
    normalized_comparison_name: c.normalized_comparison_name,
    score: c.score,
    reason: c.reason,
  }));
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

  // Primary strategy, verified live: the EXACT lookup endpoint. Its
  // results still go through the exact same non-`results[0]` scoring as
  // full-text search — an exact-name lookup can still return more than one
  // record (e.g. homonyms across ranks), so it is never trusted blindly
  // either.
  const exactUrl = buildExactLookupUrl(queryName);
  const exactResult = await fetchJson(exactUrl, { providerName: "wcvp" });
  writeRaw(rawRoot, "wcvp", `${slug}.exact`, { input_name: inputName, query_name: queryName, request_url: exactUrl, result: exactResult });

  if (!exactResult.ok) {
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
        http_status: exactResult.status ?? null,
        message: exactResult.error,
        retrieved_at: retrievedAt,
      },
    };
  }

  const exactRawResults = (exactResult.data && exactResult.data.results) || [];
  const exactSelection = scoreWcvpResults(exactRawResults, queryName);

  let rawResults = exactRawResults;
  let selection = exactSelection;
  let lookupStrategy = "exact";

  if (shouldFallbackToFullTextSearch(exactRawResults)) {
    // The exact lookup found nothing at all — worth trying full-text
    // search, scored through the exact same logic, never a silent
    // `results[0]` acceptance either way. (An `ambiguous` exact-lookup
    // result, by contrast, is NEVER a fallback trigger any more — see
    // shouldFallbackToFullTextSearch's doc comment.)
    lookupStrategy = "full_text_fallback";
    const searchUrl = buildSearchUrl(queryName);
    const searchResult = await fetchJson(searchUrl, { providerName: "wcvp" });
    writeRaw(rawRoot, "wcvp", `${slug}.search`, { input_name: inputName, query_name: queryName, request_url: searchUrl, result: searchResult });

    if (!searchResult.ok) {
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
          http_status: searchResult.status ?? null,
          message: searchResult.error,
          retrieved_at: retrievedAt,
        },
      };
    }

    rawResults = (searchResult.data && searchResult.data.results) || [];
    selection = scoreWcvpResults(rawResults, queryName);
  }

  const { selected, selection_reason, candidates } = selection;
  const auditedCandidates = auditCandidates(candidates);

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
      lookup_strategy: lookupStrategy,
      error: null,
    };
  }

  if (!canResolveTaxonomyFromSelection(selection_reason)) {
    // Spec correction: `ambiguous` must never produce a canonical
    // taxonomy. queried_usage/accepted_usage/taxonomy all stay null —
    // never built from `selected.raw` (which is only kept internally for
    // audit/tie-breaking, never presented as a resolved usage). The full
    // scored candidate list (all IDs/statuses) is preserved for audit, and
    // `requires_manual_resolution` explicitly flags that this plant needs
    // further intervention before its taxonomy can be trusted.
    return {
      input_name: inputName,
      taxonomic_parent: parentName,
      cultivar_name: cultivarName,
      not_found: false,
      selection_reason: "ambiguous",
      queried_usage: null,
      accepted_usage: null,
      taxonomy: null,
      candidates: auditedCandidates,
      lookup_strategy: lookupStrategy,
      requires_manual_resolution: true,
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
    lookup_strategy: lookupStrategy,
    taxonomy: buildTaxonomyView({ queriedUsage, acceptedUsage, synonyms }),
  };
}
