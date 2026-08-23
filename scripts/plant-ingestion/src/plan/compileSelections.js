import { planError } from "./errors.js";

// The DB has no "proposed" status column — a validated proposal becomes an
// explicit, auditable intention instead (spec §9). Never "approved":
// approval_required stays true on the plan as a whole (compiler.js).
const PROMOTION_NOTE = "Initial selection from a deterministic provider observation (dry-run promotion).";

// compileSelections(plants, observations, catalogEntries) -> { selections, errors }
// Pure. Maps each bundle trait_selection (status="proposed") to its DB
// shape (decision_method/decided_by/note, spec §9), verifies it points to
// an observation of the SAME catalog_ref+trait (§12.J), that there is only
// one selection per catalog_ref+trait (§12.K), and PROMOTES its
// normalized_value into the matching typed column of `catalogEntries`
// (mutated in place — §8/§12.N) in the same logical step, never a
// separate pass that could silently drift from the selections list.
export function compileSelections(plants, observations, catalogEntries) {
  const errors = [];
  const selections = [];
  const seenKeys = new Set();
  const observationsByRef = new Map(observations.map((o) => [o.observation_ref, o]));
  const catalogByRef = new Map(catalogEntries.map((c) => [c.catalog_ref, c]));

  for (const plant of plants) {
    for (const sel of plant.trait_selections || []) {
      const key = `${sel.catalog_ref}:${sel.trait}`;
      if (seenKeys.has(key)) {
        errors.push(planError("DUPLICATE_SELECTION", `Duplicate selection for ${key}`, { key }));
        continue;
      }
      seenKeys.add(key);

      const obs = observationsByRef.get(sel.observation_ref);
      if (!obs) {
        errors.push(planError("SELECTION_OBSERVATION_NOT_IN_PLAN", `Selection ${key} references an observation not present in the compiled plan`, { key }));
        continue;
      }
      if (obs.catalog_ref !== sel.catalog_ref || obs.trait !== sel.trait) {
        errors.push(planError("SELECTION_OBSERVATION_SCOPE_MISMATCH", `Selection ${key} references observation ${obs.observation_ref} which belongs to ${obs.catalog_ref}/${obs.trait}, not the same catalog_ref+trait`, { key }));
        continue;
      }

      const catalogEntry = catalogByRef.get(sel.catalog_ref);
      if (!catalogEntry) {
        errors.push(planError("SELECTION_CATALOG_NOT_FOUND", `Selection ${key} references a catalog_ref not present in this plan`, { key }));
        continue;
      }

      selections.push({
        catalog_ref: sel.catalog_ref,
        trait: sel.trait,
        selected_observation_ref: sel.observation_ref,
        decision_method: "provider_observation",
        decided_by: null,
        note: PROMOTION_NOTE,
      });

      // Promotion — same logical step, not a later pass (spec §8/§12.N).
      catalogEntry[sel.trait] = sel.normalized_value;
    }
  }

  return { selections, errors };
}
