// buildManualSelection(input, observationRef) -> plant_trait_selection-like object
// Pure. decision_method is a HARDCODED literal, "manual_resolution" —
// never derived from `input`, never "editorial". This is the validated
// conclusion of this chantier: only decision_method="manual_resolution" is
// protected from automatic overwrite by Layer C (see
// scripts/plant-ingestion/src/apply/upsertSelections.js) — a selection
// built with decision_method="editorial" would be silently re-syncable on
// the next automatic re-apply, defeating the entire point of a durable
// human decision. Mirrors the same "hardcoded literal, never taken from
// the input" pattern already used by Layer B's own compileSelections.js
// for decision_method="provider_observation".
export function buildManualSelection(input, observationRef) {
  const review = input.review && typeof input.review === "object" ? input.review : {};
  return {
    catalog_ref: input.catalog_ref,
    trait: input.trait,
    selected_observation_ref: observationRef,
    decision_method: "manual_resolution",
    decided_by: review.decided_by ?? null,
    note: review.note ?? null,
  };
}
