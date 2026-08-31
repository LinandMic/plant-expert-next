// guardPlan(plan) -> string[] (errors, empty = safe to apply)
// Pure, read-only, no I/O. Layer C's own defense-in-depth check that the
// plan it was handed is really a Layer-B output and not some arbitrary or
// hand-edited JSON — Layer C never re-derives or "fixes" a plan, it only
// refuses to touch the database if this check fails.
const REQUIRED_ARRAYS = ["taxa", "taxon_names", "catalog_entries", "source_records", "trait_observations", "trait_selections"];

export function guardPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== "object") {
    return ["plan must be a JSON object"];
  }
  if (plan.mode !== "transaction_plan") {
    errors.push(`plan.mode must be "transaction_plan", got ${JSON.stringify(plan.mode)}`);
  }
  if (plan.approval_required !== true) {
    errors.push(`plan.approval_required must be true, got ${JSON.stringify(plan.approval_required)}`);
  }
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(plan[key])) {
      errors.push(`plan.${key} must be an array`);
    }
  }
  if (errors.length > 0) return errors;

  // Every entry a downstream table references by *_ref must actually exist
  // in the plan — Layer B's own invariants already guarantee this for a
  // genuine compiler output, but a hand-edited or truncated plan file must
  // never reach the database silently missing a referenced row.
  const taxonRefs = new Set(plan.taxa.map((t) => t.taxon_ref));
  const catalogRefs = new Set(plan.catalog_entries.map((c) => c.catalog_ref));
  const sourceRecordRefs = new Set(plan.source_records.map((s) => s.source_record_ref));
  const observationRefs = new Set(plan.trait_observations.map((o) => o.observation_ref));

  for (const n of plan.taxon_names) {
    if (!taxonRefs.has(n.taxon_ref)) errors.push(`taxon_names entry references unknown taxon_ref "${n.taxon_ref}"`);
  }
  for (const c of plan.catalog_entries) {
    if (!taxonRefs.has(c.taxon_ref)) errors.push(`catalog_entries entry "${c.catalog_ref}" references unknown taxon_ref "${c.taxon_ref}"`);
    if (c.parent_catalog_ref && !catalogRefs.has(c.parent_catalog_ref)) {
      errors.push(`catalog_entries entry "${c.catalog_ref}" references unknown parent_catalog_ref "${c.parent_catalog_ref}"`);
    }
  }
  for (const s of plan.source_records) {
    if (!catalogRefs.has(s.catalog_ref)) errors.push(`source_records entry "${s.source_record_ref}" references unknown catalog_ref "${s.catalog_ref}"`);
  }
  for (const o of plan.trait_observations) {
    if (!catalogRefs.has(o.catalog_ref)) errors.push(`trait_observations entry "${o.observation_ref}" references unknown catalog_ref "${o.catalog_ref}"`);
    if (o.provider !== "editorial" && o.source_record_ref && !sourceRecordRefs.has(o.source_record_ref)) {
      errors.push(`trait_observations entry "${o.observation_ref}" references unknown source_record_ref "${o.source_record_ref}"`);
    }
  }
  for (const sel of plan.trait_selections) {
    if (!catalogRefs.has(sel.catalog_ref)) errors.push(`trait_selections entry for trait "${sel.trait}" references unknown catalog_ref "${sel.catalog_ref}"`);
    if (!observationRefs.has(sel.selected_observation_ref)) {
      errors.push(`trait_selections entry for trait "${sel.trait}" references unknown selected_observation_ref "${sel.selected_observation_ref}"`);
    }
  }

  return errors;
}
