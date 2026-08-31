import { sourceRecordRef } from "../refs.js";
import { planError } from "./errors.js";

const SOURCE_RECORD_FIELDS = ["provider", "provider_record_id", "provider_name", "provider_status", "selection_reason", "taxonomy_match_type", "candidate_count", "retrieved_at", "source_url", "metadata"];

// compileSourceRecords(plants) -> { sourceRecords, errors }
// Pure passthrough of exactly the plant_source_records columns (spec §10)
// — never a raw provider payload. Verifies source_record_ref uniqueness
// across the whole plan (spec §12.G). Reuses the SAME ref format the
// collector layer already stamped onto each observation's
// source_record_ref (refs.js's sourceRecordRef, "<catalogRef>:<provider>:
// current") — inventing a different format here would silently break the
// FK resolution check in compileObservations.js.
export function compileSourceRecords(plants) {
  const errors = [];
  const records = [];
  const seenRefs = new Set();

  for (const plant of plants) {
    for (const sr of plant.source_records || []) {
      const ref = sourceRecordRef({ catalogRef: sr.catalog_ref, provider: sr.provider });
      if (seenRefs.has(ref)) {
        errors.push(planError("DUPLICATE_SOURCE_RECORD_REF", `Duplicate source_record for ${ref}`, { source_record_ref: ref }));
        continue;
      }
      seenRefs.add(ref);

      const record = { source_record_ref: ref, catalog_ref: sr.catalog_ref };
      for (const field of SOURCE_RECORD_FIELDS) record[field] = sr[field];
      records.push(record);
    }
  }

  return { sourceRecords: records, errors };
}
