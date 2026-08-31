import { sourceRecordRef } from "../refs.js";
import { planError } from "./errors.js";

const OBSERVATION_FIELDS = ["trait", "provider", "field_path", "raw_value", "raw_unit", "normalized_value", "normalized_unit", "source_url", "attribution", "license", "source_retrieved_at", "uncertain", "source_scope", "review_status"];

// compileObservations(plants, sourceRecords) -> { observations, errors }
// Pure passthrough of exactly the plant_trait_observations columns (spec
// §11). Verifies observation_ref uniqueness (§12.H) and that every
// external-provider observation's source_record_ref resolves to a source
// record of the SAME catalog_ref+provider (§12.I) — never assumed.
export function compileObservations(plants, sourceRecords) {
  const errors = [];
  const observations = [];
  const seenRefs = new Set();
  const sourceRecordRefs = new Set(sourceRecords.map((sr) => sr.source_record_ref));

  for (const plant of plants) {
    for (const obs of plant.trait_observations || []) {
      if (seenRefs.has(obs.observation_ref)) {
        errors.push(planError("DUPLICATE_OBSERVATION_REF", `Duplicate observation_ref ${obs.observation_ref}`, { observation_ref: obs.observation_ref }));
        continue;
      }
      seenRefs.add(obs.observation_ref);

      if (obs.provider !== "editorial") {
        const expectedSourceRecordRef = sourceRecordRef({ catalogRef: obs.catalog_ref, provider: obs.provider });
        if (obs.source_record_ref !== expectedSourceRecordRef || !sourceRecordRefs.has(expectedSourceRecordRef)) {
          errors.push(planError("OBSERVATION_SOURCE_RECORD_MISMATCH", `Observation ${obs.observation_ref} does not resolve to a source record for ${expectedSourceRecordRef}`, { observation_ref: obs.observation_ref }));
          continue;
        }
      }

      const record = { observation_ref: obs.observation_ref, catalog_ref: obs.catalog_ref, source_record_ref: obs.source_record_ref ?? null };
      for (const field of OBSERVATION_FIELDS) record[field] = obs[field];
      observations.push(record);
    }
  }

  return { observations, errors };
}
