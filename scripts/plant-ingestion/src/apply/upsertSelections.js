// Layer C, table 6: plant_trait_selections.
//
// Natural key: (plant_catalog_id, trait) — real unique constraint
// plant_trait_selections_one_per_catalog_trait. decision_method's allowed
// values, per the real CHECK constraint (plant_trait_selections_
// decision_method_check): 'provider_observation' | 'editorial' |
// 'manual_resolution'.
//
// CRITICAL safety rule: a row whose STORED decision_method is
// "manual_resolution" is NEVER touched again, under any circumstance — a
// curator overrode the automatic pick by hand, and blindly re-syncing to
// the plan's recommendation on every re-apply would silently clobber that
// human decision. The protection is keyed on what is actually in the DB,
// not on what the plan says (the plan itself can never even produce
// "manual_resolution" — see Layer B's compileSelections.js — so checking
// the plan's own decision_method would never catch this case).
//
// A row whose stored decision_method is automatic (provider_observation or
// editorial) IS allowed to be updated when the plan's recommendation
// genuinely differs — e.g. a re-ingestion run picked a different
// observation, or the automatic method itself changed. If it is already
// identical to the plan, it is reported "unchanged" (no write issued).
const COMPARE_FIELDS = ["selected_observation_id", "decision_method", "decided_by", "note"];

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

function fieldsDiffer(existingRow, planRow) {
  return COMPARE_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(planRow[field] ?? null));
}

// upsertSelections({ client, selections, catalogIdByRef, observationIdByRef, dryRun })
//   -> { created, updated, unchanged, errors }
// No idByRef is returned: nothing downstream references a selection by
// *_ref.
export async function upsertSelections({ client, selections, catalogIdByRef, observationIdByRef, dryRun }) {
  const errors = [];
  let created = 0, updated = 0, unchanged = 0;

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
      .select(["id", ...COMPARE_FIELDS].join(", "))
      .eq("plant_catalog_id", catalogId)
      .eq("trait", sel.trait)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_trait_selections lookup failed for ${sel.catalog_ref}/${sel.trait}: ${selectError.message}`);
      continue;
    }

    if (!existing) {
      created += 1;
      if (dryRun) continue;
      const row = selectionRowFromPlan(sel, catalogId, observationId);
      const { error: insertError } = await client.from("plant_trait_selections").insert(row);
      if (insertError) errors.push(`plant_trait_selections insert failed for ${sel.catalog_ref}/${sel.trait}: ${insertError.message}`);
      continue;
    }

    if (existing.decision_method === "manual_resolution") {
      // Curator override — never touched, regardless of what the plan says.
      unchanged += 1;
      continue;
    }

    const row = selectionRowFromPlan(sel, catalogId, observationId);
    if (!fieldsDiffer(existing, row)) {
      unchanged += 1;
      continue;
    }

    updated += 1;
    if (dryRun) continue;
    const { error: updateError } = await client.from("plant_trait_selections").update(row).eq("id", existing.id);
    if (updateError) errors.push(`plant_trait_selections update failed for ${sel.catalog_ref}/${sel.trait}: ${updateError.message}`);
  }

  return { created, updated, unchanged, errors };
}
