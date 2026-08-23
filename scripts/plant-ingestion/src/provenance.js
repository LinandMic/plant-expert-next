import { classifyMatch } from "../../plant-benchmark/src/taxonomyMatch.js";
import { deriveProviderStatus } from "./crosswalks.js";
import { sourceRecordRef as buildSourceRecordRef, observationRef } from "./refs.js";
import { isInformative } from "./informative.js";
import { assessTaxonomyAmbiguity } from "./taxonomyAmbiguity.js";

// Deterministic field_path fallback for Perenual traits — the reused
// benchmark provider (mapPerenualDetailToTraits) only sets field_path for
// the array-shaped `dimensions` entries; every other trait is a direct,
// unambiguous top-level field read (e.g. `d.type`, `d.sunlight`), so its
// path is just as deterministic even though the reused function itself
// doesn't record it. Only ever used as a FALLBACK when the observation's
// own field_path is absent — never overrides a path the provider code
// already set (e.g. the dimensions[...] paths, or any future addition).
const PERENUAL_FIELD_PATH_FALLBACK = {
  plant_type: "type",
  sun: "sunlight",
  soil: "soil",
  growth_rate: "growth_rate",
  drought_tolerance: "drought",
  water_need: "watering",
  indoor: "indoor",
  container_suitable: "container",
  attracts: "attracts",
  hardiness_min: "hardiness.min",
  hardiness_max: "hardiness.max",
  flowering_season: "flowering_season",
  edible_fruit: "edible_fruit",
  edible_leaf: "edible_leaf",
  // "edible" is DERIVED from edible_fruit + edible_leaf (see
  // mapPerenualDetailToTraits) — never attributed to a single field. This
  // explicit compound path documents that derivation rather than pointing
  // at either source field alone (which would misrepresent it as directly
  // read) or silently staying null (which would look like missing
  // provenance rather than a deliberate derivation).
  edible: "edible_fruit+edible_leaf",
};

// Derives the WCVP provider's raw operational status. The reused WCVP
// provider never returns a `status` field directly (only `selection_reason`
// + `not_found` + `error`) — this reconstructs the equivalent so it can go
// through the same deriveProviderStatus() narrowing as the other two
// providers, uniformly.
function wcvpRawStatus(wcvpResult) {
  if (wcvpResult.error) return "provider_error";
  if (wcvpResult.not_found) return "not_found";
  return wcvpResult.selection_reason; // exact_scientific_match | ambiguous
}

// buildSourceRecord({ provider, catalogRef, result, wcvpTaxonomy, retrievedAt })
// -> { source_record, source_record_ref }
// Pure. Never stores a raw provider payload (spec §8) — only the specific
// fields plant_source_records is designed to hold.
export function buildSourceRecord({ provider, catalogRef, result, wcvpTaxonomy = null, retrievedAt, cultivarName = null }) {
  const ref = buildSourceRecordRef({ catalogRef, provider });

  if (provider === "wcvp") {
    const rawStatus = wcvpRawStatus(result);
    const providerRecordId = result.accepted_usage?.taxon_id ?? result.queried_usage?.taxon_id ?? null;
    return {
      source_record_ref: ref,
      source_record: {
        catalog_ref: catalogRef,
        provider: "wcvp",
        provider_record_id: providerRecordId != null ? String(providerRecordId) : null,
        provider_name: null,
        provider_status: deriveProviderStatus(rawStatus),
        selection_reason: result.selection_reason ?? null,
        taxonomy_match_type: null,
        candidate_count: Array.isArray(result.candidates) ? result.candidates.length : null,
        retrieved_at: retrievedAt,
        source_url: providerRecordId != null ? `https://api.gbif.org/v1/species/${providerRecordId}` : null,
        metadata: { lookup_strategy: result.lookup_strategy ?? null },
      },
      taxonomy_ambiguity: { applicable: false, resolved: true, explanation: null },
    };
  }

  // perenual / trefle
  const record = result.record || result.search_candidate || null;
  const providerRecordId = record && record.id != null ? String(record.id) : null;
  const taxonomyMatchType = record && record.scientific_name
    ? classifyMatch({ providerName: record.scientific_name, wcvpTaxonomy, cultivarParentName: wcvpTaxonomy ? wcvpTaxonomy.accepted_name : null })
    : null;

  const metadata = provider === "perenual"
    ? {
        cultivar_field: record?.cultivar_field ?? null,
        variety_field: record?.variety_field ?? null,
        subspecies_field: record?.subspecies_field ?? null,
        hybrid_field: record?.hybrid_field ?? null,
      }
    : {
        record_sources_count: Array.isArray(result.provenance?.record_sources) ? result.provenance.record_sources.length : null,
      };

  // See taxonomyAmbiguity.js: an "ambiguous" cross-check for a cultivar is
  // structurally expected (WCVP never publishes cultivar epithets) — this
  // narrowly recognizes that specific, fully-explainable shape without
  // ever rewriting taxonomy_match_type itself.
  const taxonomyAmbiguity = assessTaxonomyAmbiguity({
    taxonomyMatchType,
    candidateName: record ? record.scientific_name : null,
    acceptedName: wcvpTaxonomy ? wcvpTaxonomy.accepted_name : null,
    cultivarName,
    selectionReason: result.selection_reason ?? null,
    candidateCount: result.candidate_count ?? null,
  });

  return {
    source_record_ref: ref,
    source_record: {
      catalog_ref: catalogRef,
      provider,
      provider_record_id: providerRecordId,
      provider_name: record?.provider_name ?? null,
      provider_status: deriveProviderStatus(result.status),
      selection_reason: result.selection_reason ?? null,
      taxonomy_match_type: taxonomyMatchType,
      candidate_count: result.candidate_count ?? null,
      retrieved_at: retrievedAt,
      source_url: record?.source_url ?? null,
      metadata,
    },
    taxonomy_ambiguity: taxonomyAmbiguity,
  };
}

// buildObservations({ provider, catalogRef, sourceRecordRef, result })
// -> trait_observation[]
// Pure. A provider result with no traits (not_found, no record, error, ...)
// produces an EMPTY array — never a fictitious placeholder observation
// (spec §9/§10, test #13). A trait whose raw_value is non-informative
// ([], {}, "", null, undefined) produces NO observation at all — never a
// fabricated one, and never silently coerced to null just to have
// something to store (spec: "l'observation doit simplement ne pas
// exister"). false and 0 remain fully informative and always produce one.
export function buildObservations({ provider, catalogRef, sourceRecordRef, result }) {
  const observations = [];
  const traits = result && result.traits ? result.traits : {};

  for (const [trait, entry] of Object.entries(traits)) {
    const rawObservations = (entry && entry.observations) || [];
    rawObservations.forEach((obs, index) => {
      if (!isInformative(obs.raw_value)) return;
      const fallbackFieldPath = provider === "perenual" ? PERENUAL_FIELD_PATH_FALLBACK[trait] ?? null : null;
      observations.push({
        observation_ref: observationRef({ catalogRef, provider, trait, index }),
        catalog_ref: catalogRef,
        trait,
        provider,
        field_path: obs.field_path ?? fallbackFieldPath,
        raw_value: obs.raw_value ?? null,
        raw_unit: obs.raw_unit ?? null,
        normalized_value: obs.normalized_value ?? null,
        normalized_unit: obs.normalized_unit ?? null,
        source_record_ref: sourceRecordRef,
        source_url: obs.source_url ?? null,
        attribution: obs.attribution ?? null,
        license: obs.license ?? null,
        source_retrieved_at: obs.retrieved_at ?? null,
        uncertain: Boolean(obs.uncertain),
        // Both Perenual and Trefle traits come from a single detail-endpoint
        // fetch, never a per-trait endpoint — provenance is only ever
        // proven at record level (spec §10, confirmed for Trefle, applies
        // identically to Perenual for the same structural reason).
        source_scope: "record",
        review_status: "unreviewed",
      });
    });
  }

  return observations;
}
