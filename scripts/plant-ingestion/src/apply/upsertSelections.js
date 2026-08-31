// Layer C, table 6: plant_trait_selections.
//
// Natural key: (plant_catalog_id, trait) — real unique constraint
// plant_trait_selections_one_per_catalog_trait.
//
// CRITICAL safety rule: once a selection row exists for a (catalog, trait)
// pair, Layer C NEVER updates it, under any circumstance — not even if the
// plan's recommended observation differs from what's stored. decision_method
// can be "manual_resolution", meaning a curator overrode the automatic
// provider-observation pick by hand; blindly re-syncing to the plan's
// recommendation on every re-apply would silently clobber that human
// decision. So: insert when missing, otherwise always report "unchanged"
// and leave the row exactly as it is — this file has no update code path
// at all, by design, not as an oversight.
function selectionRowFromPlan(sel, catalogId, observationId) {
  return {
    plant_catalog_id: catalogId,
    trait: sel.trait,
    selected_observation_id: observationId,
    decision_method: sel.decision_method,
    decided_by: sel.decided_by ?? null,
    note: sel.note ?? null,
  };
}

// upsertSelections({ client, selections, catalogIdByRef, observationIdByRef, dryRun })
//   -> { created, updated, unchanged, errors }
// `updated` is always 0 — see the file-level comment above. No idByRef is
// returned: nothing downstream references a selection by *_ref.
export async function upsertSelections({ client, selections, catalogIdByRef, observationIdByRef, dryRun }) {
  const errors = [];
  let created = 0, unchanged = 0;
  const updated = 0;

  for (const sel of selections) {
    const catalogId = catalogIdByRef.get(sel.catalog_ref);
    const observationId = observationIdByRef.get(sel.selected_observation_ref);

    if (!catalogId || !observationId) {
      // Parent catalog entry or the selected observation doesn't exist yet
      // — this selection would be created alongside it.
      created += 1;
      continue;
    }

    const { data: existing, error: selectError } = await client
      .from("plant_trait_selections")
      .select("id")
      .eq("plant_catalog_id", catalogId)
      .eq("trait", sel.trait)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_trait_selections lookup failed for ${sel.catalog_ref}/${sel.trait}: ${selectError.message}`);
      continue;
    }

    if (existing) {
      // Already decided — never touched again, manual_resolution or not.
      unchanged += 1;
      continue;
    }

    created += 1;
    if (dryRun) continue;
    const row = selectionRowFromPlan(sel, catalogId, observationId);
    const { error: insertError } = await client.from("plant_trait_selections").insert(row);
    if (insertError) errors.push(`plant_trait_selections insert failed for ${sel.catalog_ref}/${sel.trait}: ${insertError.message}`);
  }

  return { created, updated, unchanged, errors };
}
