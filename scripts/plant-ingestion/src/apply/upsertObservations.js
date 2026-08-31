// Layer C, table 5: plant_trait_observations.
//
// This table has NO real natural-key uniqueness constraint (only a
// technical composite (id, plant_catalog_id, trait) that exists purely so
// plant_trait_selections can have a composite FK into it — see the
// migration's plant_trait_selections_observation_fk). It is append-only by
// design: each row is one raw provider observation, and the schema's own
// comment treats re-observation as normal, not as an update target.
//
// Dedup here is therefore application-level only: an incoming plan
// observation is treated as "already present" when an existing row matches
// on (plant_catalog_id, trait, provider, field_path, plant_source_record_id)
// AND has a deep-equal raw_value. Anything else is a genuine new
// observation and is inserted — never updated, there is no update path for
// this table (matches its "individual raw observations" role: history is
// additive, not overwritten).
const DEDUP_FIELDS = ["plant_catalog_id", "trait", "provider", "field_path", "plant_source_record_id"];

function normalizeForCompare(value) {
  return JSON.stringify(value ?? null);
}

function observationRowFromPlan(o, catalogId, sourceRecordId) {
  return {
    plant_catalog_id: catalogId,
    trait: o.trait,
    provider: o.provider,
    field_path: o.field_path ?? null,
    raw_value: o.raw_value ?? null,
    raw_unit: o.raw_unit ?? null,
    normalized_value: o.normalized_value ?? null,
    normalized_unit: o.normalized_unit ?? null,
    plant_source_record_id: sourceRecordId,
    source_url: o.source_url ?? null,
    attribution: o.attribution ?? null,
    license: o.license ?? null,
    source_retrieved_at: o.source_retrieved_at ?? null,
    uncertain: o.uncertain ?? false,
    source_scope: o.source_scope,
    review_status: o.review_status ?? "unreviewed",
  };
}

function findDuplicate(existingRows, row) {
  return existingRows.find((existing) => {
    const sameKey = DEDUP_FIELDS.every((field) => normalizeForCompare(existing[field]) === normalizeForCompare(row[field]));
    return sameKey && normalizeForCompare(existing.raw_value) === normalizeForCompare(row.raw_value);
  });
}

// upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun })
//   -> { idByRef, created, updated, unchanged, errors }
// `updated` is always 0 here — there is no update path, kept only so the
// return shape matches every other upsert*/report aggregation code.
export async function upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  let created = 0, unchanged = 0;
  const updated = 0;

  // Cache existing rows per catalogId so repeated observations for the same
  // catalog entry (the common case) issue one lookup, not one per trait.
  const existingByCatalogId = new Map();

  for (const o of observations) {
    const catalogId = catalogIdByRef.get(o.catalog_ref);
    if (!catalogId) {
      created += 1;
      idByRef.set(o.observation_ref, null);
      continue;
    }

    const sourceRecordId = o.provider === "editorial" ? null : (o.source_record_ref ? sourceRecordIdByRef.get(o.source_record_ref) ?? null : null);
    if (o.provider !== "editorial" && o.source_record_ref && !sourceRecordId) {
      // Parent source record doesn't exist yet — this observation would be
      // created alongside it.
      created += 1;
      idByRef.set(o.observation_ref, null);
      continue;
    }

    if (!existingByCatalogId.has(catalogId)) {
      const { data, error } = await client
        .from("plant_trait_observations")
        .select("id, plant_catalog_id, trait, provider, field_path, raw_value, plant_source_record_id")
        .eq("plant_catalog_id", catalogId);
      if (error) {
        errors.push(`plant_trait_observations lookup failed for catalog id ${catalogId}: ${error.message}`);
        existingByCatalogId.set(catalogId, []);
      } else {
        existingByCatalogId.set(catalogId, data ?? []);
      }
    }

    const row = observationRowFromPlan(o, catalogId, sourceRecordId);
    const duplicate = findDuplicate(existingByCatalogId.get(catalogId), row);

    if (duplicate) {
      unchanged += 1;
      idByRef.set(o.observation_ref, duplicate.id);
      continue;
    }

    created += 1;
    if (dryRun) {
      idByRef.set(o.observation_ref, null);
      continue;
    }
    const { data: inserted, error: insertError } = await client.from("plant_trait_observations").insert(row).select("id").single();
    if (insertError) {
      errors.push(`plant_trait_observations insert failed for ${o.observation_ref}: ${insertError.message}`);
      idByRef.set(o.observation_ref, null);
      continue;
    }
    idByRef.set(o.observation_ref, inserted.id);
    // Keep the local cache in sync so a later observation in this same run,
    // for the same catalog entry, correctly dedups against it too.
    existingByCatalogId.get(catalogId).push({ id: inserted.id, ...row });
  }

  return { idByRef, created, updated, unchanged, errors };
}
