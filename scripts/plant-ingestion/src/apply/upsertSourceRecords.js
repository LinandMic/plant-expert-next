// Layer C, table 4: plant_source_records.
//
// Natural key for "the current record": (plant_catalog_id, provider) where
// superseded_at is null — this is a real partial unique index
// (plant_source_records_one_current_per_provider). The table is append-only
// by design (see the migration's own comment): re-fetching the same
// provider for the same catalog entry never overwrites history, it
// supersedes the previous current row and inserts a new one.
//
// For Layer C idempotence specifically: re-applying the exact same plan
// must never supersede anything, because the plan's own fields are
// byte-identical to what's already current — so a genuine re-apply is
// always "unchanged", and supersession only fires when the plan really
// does carry new data (e.g. a fresh ingestion run fetched an updated
// record).
//
// retrieved_at is deliberately EXCLUDED from COMPARE_FIELDS. It records
// provenance/audit information — the moment this provider was queried —
// not the content of the answer. A fresh Layer A/B run re-stamps
// retrieved_at to "now" on every regeneration even when the provider
// returns byte-identical data (same provider_record_id, same metadata,
// same taxonomy match, same source_url) — so comparing it would make
// re-running the same, unchanged ingestion look like a genuine content
// change forever, defeating idempotence and creating supersession churn
// with no real new information. retrieved_at is still written on every
// INSERT (the row created by insert/re-insert keeps its own real
// collection timestamp, see sourceRecordRowFromPlan below) — only the
// decision of "is this a genuine change" ignores it.
const COMPARE_FIELDS = ["provider_record_id", "provider_name", "provider_status", "selection_reason", "taxonomy_match_type", "candidate_count", "source_url", "metadata"];

function sourceRecordRowFromPlan(s, catalogId) {
  return {
    plant_catalog_id: catalogId,
    provider: s.provider,
    provider_record_id: s.provider_record_id ?? null,
    provider_name: s.provider_name ?? null,
    provider_status: s.provider_status,
    selection_reason: s.selection_reason ?? null,
    taxonomy_match_type: s.taxonomy_match_type ?? null,
    candidate_count: s.candidate_count ?? null,
    retrieved_at: s.retrieved_at,
    source_url: s.source_url ?? null,
    metadata: s.metadata ?? null,
  };
}

function fieldsDiffer(existingRow, planRow) {
  return COMPARE_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(planRow[field] ?? null));
}

// upsertSourceRecords({ client, sourceRecords, catalogIdByRef, dryRun }) -> { idByRef, created, updated, unchanged, errors }
// `updated` here specifically means "superseded" (old row closed, new
// current row inserted) — reported this way in the CLI summary.
export async function upsertSourceRecords({ client, sourceRecords, catalogIdByRef, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  let created = 0, updated = 0, unchanged = 0;

  for (const s of sourceRecords) {
    const catalogId = catalogIdByRef.get(s.catalog_ref);
    if (!catalogId) {
      created += 1;
      idByRef.set(s.source_record_ref, null);
      continue;
    }

    const { data: existing, error: selectError } = await client
      .from("plant_source_records")
      .select(["id", ...COMPARE_FIELDS].join(", "))
      .eq("plant_catalog_id", catalogId)
      .eq("provider", s.provider)
      .is("superseded_at", null)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_source_records lookup failed for ${s.source_record_ref}: ${selectError.message}`);
      idByRef.set(s.source_record_ref, null);
      continue;
    }

    const row = sourceRecordRowFromPlan(s, catalogId);

    if (!existing) {
      created += 1;
      if (dryRun) {
        idByRef.set(s.source_record_ref, null);
        continue;
      }
      const { data: inserted, error: insertError } = await client.from("plant_source_records").insert(row).select("id").single();
      if (insertError) {
        errors.push(`plant_source_records insert failed for ${s.source_record_ref}: ${insertError.message}`);
        idByRef.set(s.source_record_ref, null);
        continue;
      }
      idByRef.set(s.source_record_ref, inserted.id);
      continue;
    }

    if (!fieldsDiffer(existing, row)) {
      unchanged += 1;
      idByRef.set(s.source_record_ref, existing.id);
      continue;
    }

    // Genuine change: supersede the old current row, insert a new one.
    updated += 1;
    if (dryRun) {
      // Nothing is actually written in dry-run — the existing row is
      // NOT superseded, it is still the real current row in the DB right
      // now. Point idByRef at it (not a fabricated/null id) so downstream
      // steps (observations, selections) can still perform their own real
      // DB lookup/dedup against it, instead of falling into their own
      // "parent doesn't exist yet" cascade and misreporting themselves as
      // "created" for data that already exists unchanged.
      idByRef.set(s.source_record_ref, existing.id);
      continue;
    }
    const { error: supersedeError } = await client
      .from("plant_source_records")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (supersedeError) {
      errors.push(`plant_source_records supersede failed for ${s.source_record_ref}: ${supersedeError.message}`);
      idByRef.set(s.source_record_ref, null);
      continue;
    }
    const { data: inserted, error: insertError } = await client.from("plant_source_records").insert(row).select("id").single();
    if (insertError) {
      errors.push(`plant_source_records re-insert failed for ${s.source_record_ref}: ${insertError.message}`);
      idByRef.set(s.source_record_ref, null);
      continue;
    }
    idByRef.set(s.source_record_ref, inserted.id);
  }

  return { idByRef, created, updated, unchanged, errors };
}
