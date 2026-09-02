import { observationRef } from "../refs.js";

// buildAttribution({ title, publisher }) -> string | null
// Kept for backward compatibility (spec §6: "ne pas supprimer attribution
// dans cette migration") — source_title/source_publisher are now the
// canonical structured fields, this remains a convenience display string
// derived from them. Returns null when both are absent (always true for
// curation.method=expert_knowledge, which has no source at all).
function buildAttribution({ title, publisher }) {
  const t = title ? title.trim() : "";
  const p = publisher ? publisher.trim() : "";
  if (t && p && t !== p) return `${t} — ${p}`;
  return t || p || null;
}

// buildEditorialObservation(input) -> plant_trait_observation-like object
// Pure. Assumes `input` already passed validateEditorialInput() with zero
// errors — never re-validates, never mutates `input`. Every field the real
// DB constraint (plant_trait_observations_editorial_coherence_check)
// forces for an editorial row is HARDCODED here, never taken from `input`:
//   provider="editorial", source_scope="editorial",
//   plant_source_record_id=null.
// review_status="accepted" and reviewed_at=now(): this builder only ever
// runs after a human has already reviewed the input (curation workflow
// step 5, before step 6 which is this builder's own output) — never
// "unreviewed" by construction, and reviewed_at genuinely represents when
// this reviewed observation was built, the same way created_at represents
// when it later reaches the DB (see the migration's comment on why a
// separate curated_at column was NOT added).
//
// Provenance duality (frozen by the migration this builder now targets):
//   license           = licence de la SOURCE consultée (null for
//                        expert_knowledge — there is no source)
//   curation_license   = licence/statut de NOTRE PROPRE synthèse — always
//                        set, from input.curation.license, and NEVER
//                        derived from or copied over `license`.
// source_retrieved_at is null for expert_knowledge (no source consulted)
// and input.source.retrieved_at for open_source_synthesis — the DB now
// allows a non-null value here for editorial rows (previously forced
// null; see the migration).
export function buildEditorialObservation(input) {
  const method = input.curation.method;
  const source = method === "expert_knowledge" ? null : input.source;

  return {
    observation_ref: observationRef({ catalogRef: input.catalog_ref, provider: "editorial", trait: input.trait }),
    catalog_ref: input.catalog_ref,
    trait: input.trait,
    provider: "editorial",
    field_path: null,
    raw_value: input.raw_value,
    raw_unit: input.raw_unit ?? null,
    normalized_value: input.normalized_value,
    normalized_unit: input.normalized_unit ?? null,
    source_record_ref: null,
    plant_source_record_id: null,
    source_url: source ? source.url : null,
    source_title: source ? source.title : null,
    source_publisher: source ? source.publisher : null,
    attribution: source ? buildAttribution(source) : null,
    license: source ? source.license : null,
    curation_license: input.curation.license,
    curation_method: method,
    curated_by: input.curation.curated_by ?? null,
    source_retrieved_at: source ? source.retrieved_at : null,
    uncertain: false,
    source_scope: "editorial",
    review_status: "accepted",
    reviewed_by: (input.review && input.review.reviewed_by) ?? null,
    reviewed_at: new Date().toISOString(),
  };
}
