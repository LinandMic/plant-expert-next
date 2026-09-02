import { stableEqual } from "./stableEqual.js";

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
//
// raw_value is compared with stableEqual (jsonb key order ignored), not a
// naive JSON.stringify — found against real production data: the "edible"
// trait's raw_value ({edible_leaf, edible_fruit}) round-tripped through
// Postgres with a different key order than the plan literal, which would
// have made findDuplicate miss a real match. DEDUP_FIELDS themselves stay
// on the simple JSON.stringify-based normalizeForCompare — they are all
// plain scalars (uuid/text strings), never objects or arrays, so there is
// no key-order risk there and no reason to complicate that comparison.
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
    // source_title/source_publisher/curation_license/curated_by/
    // curation_method/reviewed_by/reviewed_at: added by the editorial
    // provenance migration (2026-09-02). A provider observation (trefle/
    // perenual/wcvp) never sets these on its plan entry, so `?? null`
    // keeps every existing provider row's shape byte-for-byte unchanged —
    // this is purely additive for the editorial path.
    source_title: o.source_title ?? null,
    source_publisher: o.source_publisher ?? null,
    attribution: o.attribution ?? null,
    license: o.license ?? null,
    curation_license: o.curation_license ?? null,
    curated_by: o.curated_by ?? null,
    curation_method: o.curation_method ?? null,
    source_retrieved_at: o.source_retrieved_at ?? null,
    uncertain: o.uncertain ?? false,
    source_scope: o.source_scope,
    review_status: o.review_status ?? "unreviewed",
    reviewed_by: o.reviewed_by ?? null,
    reviewed_at: o.reviewed_at ?? null,
  };
}

function findDuplicate(existingRows, row) {
  return existingRows.find((existing) => {
    const sameKey = DEDUP_FIELDS.every((field) => normalizeForCompare(existing[field]) === normalizeForCompare(row[field]));
    return sameKey && stableEqual(existing.raw_value, row.raw_value);
  });
}

// A sentinel distinct from a real (possibly empty) result array — an empty
// array means "this catalog genuinely has zero existing observations",
// which must still run findDuplicate normally (finding nothing, correctly
// reporting "created"). A failed lookup must NEVER be treated the same way
// — silently falling back to an empty array previously made every row
// under a failed catalog lookup look like a legitimate "created", masking
// a real read failure as if it were new data.
const LOOKUP_FAILED = Symbol("lookup_failed");

// upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun })
//   -> { idByRef, created, updated, unchanged, failed, errors }
// `updated` is always 0 here — there is no update path, kept only so the
// return shape matches every other upsert*/report aggregation code.
//
// Accounting invariant: every single input row ends in EXACTLY ONE of
// created / updated(never, for this table) / unchanged / failed — never
// silently unaccounted for. This is enforced structurally (every loop
// iteration takes exactly one bucket-incrementing branch, then
// `continue`s) AND verified explicitly at the end: if
// created+updated+unchanged+failed does not equal the number of input
// rows, that is itself reported as an error — never silently masked by
// forcing the totals to match.
export async function upsertObservations({ client, observations, catalogIdByRef, sourceRecordIdByRef, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  let created = 0, unchanged = 0, failed = 0;
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
        existingByCatalogId.set(catalogId, LOOKUP_FAILED);
      } else {
        existingByCatalogId.set(catalogId, data ?? []);
      }
    }

    const cached = existingByCatalogId.get(catalogId);
    if (cached === LOOKUP_FAILED) {
      // The lookup itself failed — this row's true state is unknown, it
      // must NEVER be reported as "created" (that would fabricate a
      // decision Layer C never actually verified against the DB).
      failed += 1;
      idByRef.set(o.observation_ref, null);
      continue;
    }

    const row = observationRowFromPlan(o, catalogId, sourceRecordId);
    const duplicate = findDuplicate(cached, row);

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
      // Reclassify: this row was tentatively counted "created" above, but
      // the write itself failed — move it to "failed" so every row still
      // lands in exactly one bucket, never double-booked.
      created -= 1;
      failed += 1;
      errors.push(`plant_trait_observations insert failed for ${o.observation_ref}: ${insertError.message}`);
      idByRef.set(o.observation_ref, null);
      continue;
    }
    idByRef.set(o.observation_ref, inserted.id);
    // Keep the local cache in sync so a later observation in this same run,
    // for the same catalog entry, correctly dedups against it too.
    existingByCatalogId.get(catalogId).push({ id: inserted.id, ...row });
  }

  const accounted = created + updated + unchanged + failed;
  if (accounted !== observations.length) {
    errors.push(`accounting mismatch: input=${observations.length} accounted=${accounted} (created=${created} updated=${updated} unchanged=${unchanged} failed=${failed})`);
  }

  return { idByRef, created, updated, unchanged, failed, errors, inputCount: observations.length, accountedCount: accounted };
}
