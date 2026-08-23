import { classifyMatch } from "../../plant-benchmark/src/taxonomyMatch.js";
import { deriveProviderStatus } from "./crosswalks.js";
import { sourceRecordRef as buildSourceRecordRef, observationRef } from "./refs.js";

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
export function buildSourceRecord({ provider, catalogRef, result, wcvpTaxonomy = null, retrievedAt }) {
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
  };
}

// buildObservations({ provider, catalogRef, sourceRecordRef, result })
// -> trait_observation[]
// Pure. A provider result with no traits (not_found, no record, error, ...)
// produces an EMPTY array — never a fictitious placeholder observation
// (spec §9/§10, test #13).
export function buildObservations({ provider, catalogRef, sourceRecordRef, result }) {
  const observations = [];
  const traits = result && result.traits ? result.traits : {};

  for (const [trait, entry] of Object.entries(traits)) {
    const rawObservations = (entry && entry.observations) || [];
    rawObservations.forEach((obs, index) => {
      observations.push({
        observation_ref: observationRef({ catalogRef, provider, trait, index }),
        catalog_ref: catalogRef,
        trait,
        provider,
        field_path: obs.field_path ?? null,
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
