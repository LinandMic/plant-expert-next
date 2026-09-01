import { observationRef } from "../refs.js";

// buildAttribution({ title, publisher }) -> string | null
// Built once here so every editorial observation gets the same
// deterministic "Title — Publisher" shape, never hand-typed per curation.
// Falls back to whichever of the two is present if they are identical
// (never a dangling "— " with nothing on one side).
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
// forces for an editorial row is HARDCODED here, never taken from `input`,
// so a curation input can never accidentally produce a non-compliant row:
//   provider="editorial", source_scope="editorial",
//   plant_source_record_id=null, source_retrieved_at=null.
// review_status="accepted": this builder only ever runs after a human has
// already reviewed the input (curation workflow step 5, before step 6
// which is this builder's own output) — never "unreviewed" by construction.
// field_path stays null: an editorial value has no field to point at in a
// provider payload, only a source_url/attribution/license triple.
export function buildEditorialObservation(input) {
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
    source_url: input.source.url,
    attribution: buildAttribution(input.source),
    license: input.source.license,
    source_retrieved_at: null,
    uncertain: false,
    source_scope: "editorial",
    review_status: "accepted",
  };
}
