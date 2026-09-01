import { buildEditorialObservation } from "./buildEditorialObservation.js";
import { buildManualSelection } from "./buildManualSelection.js";

// guardEditorialPlan(plan) -> string[]
// Pure, read-only self-check — same philosophy as apply/planGuard.js
// (never let a malformed plan leak downstream), scoped to this plan's own,
// deliberately smaller shape: only editorial_observations and
// manual_selections, nothing else. Never touches a real DB (stays pure) —
// checking a catalog_ref against Supabase is checkEditorialAgainstDb.js's
// job, not this one's.
export function guardEditorialPlan(plan) {
  const errors = [];

  if (!plan || plan.mode !== "editorial_plan") errors.push('plan.mode must be "editorial_plan"');
  if (!plan || plan.approval_required !== true) errors.push("plan.approval_required must be true");
  if (!plan || !Array.isArray(plan.editorial_observations)) errors.push("plan.editorial_observations must be an array");
  if (!plan || !Array.isArray(plan.manual_selections)) errors.push("plan.manual_selections must be an array");
  if (errors.length > 0) return errors;

  const observationRefs = new Set(plan.editorial_observations.map((o) => o.observation_ref));

  for (const o of plan.editorial_observations) {
    if (o.provider !== "editorial") errors.push(`editorial_observations entry ${o.observation_ref} has provider "${o.provider}", expected "editorial"`);
    if (o.source_scope !== "editorial") errors.push(`editorial_observations entry ${o.observation_ref} has source_scope "${o.source_scope}", expected "editorial"`);
    if (o.plant_source_record_id !== null || o.source_record_ref) {
      errors.push(`editorial_observations entry ${o.observation_ref} must never reference a source_record`);
    }
  }

  for (const sel of plan.manual_selections) {
    if (sel.decision_method !== "manual_resolution") {
      errors.push(`manual_selections entry for ${sel.catalog_ref}/${sel.trait} has decision_method "${sel.decision_method}", expected "manual_resolution"`);
    }
    if (!observationRefs.has(sel.selected_observation_ref)) {
      errors.push(`manual_selections entry for ${sel.catalog_ref}/${sel.trait} references unknown observation_ref "${sel.selected_observation_ref}"`);
    }
  }

  return errors;
}

// buildEditorialPlan(inputs) -> editorial plan
// Pure. Every entry of `inputs` must already have passed
// validateEditorialInput() with zero errors — this function does not
// re-validate value shapes, only structural duplicates within the batch.
// Deliberately NEVER produces taxa/taxon_names/source_records/
// catalog_entries — this plan is an overlay onto catalog entries that
// already exist, never a way to create them (spec §5). Throws on a
// duplicate (catalog_ref, trait) pair rather than silently keeping the
// first or last one — fail explicit, matching every other compiler in this
// pipeline. Self-validates its own output via guardEditorialPlan() before
// returning, the same defense-in-depth pattern filterPlan.js already uses
// with guardPlan().
export function buildEditorialPlan(inputs) {
  const editorial_observations = [];
  const manual_selections = [];
  const seen = new Set();

  for (const input of inputs) {
    const key = `${input.catalog_ref}:${input.trait}`;
    if (seen.has(key)) {
      throw new Error(`buildEditorialPlan: duplicate editorial input for ${key}`);
    }
    seen.add(key);

    const observation = buildEditorialObservation(input);
    editorial_observations.push(observation);
    manual_selections.push(buildManualSelection(input, observation.observation_ref));
  }

  const plan = {
    mode: "editorial_plan",
    approval_required: true,
    generated_at: new Date().toISOString(),
    editorial_observations,
    manual_selections,
    summary: {
      editorial_observations: editorial_observations.length,
      manual_selections: manual_selections.length,
    },
  };

  const guardErrors = guardEditorialPlan(plan);
  if (guardErrors.length > 0) {
    throw new Error(`buildEditorialPlan: produced an invalid plan — ${guardErrors.join("; ")}`);
  }

  return plan;
}
