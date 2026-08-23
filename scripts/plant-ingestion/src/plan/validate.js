import { isInformative } from "../informative.js";
import { PROMOTABLE_CATALOG_COLUMNS } from "./catalogColumns.js";
import { planError } from "./errors.js";

// validateBundleForCompilation(bundle) -> planError[]
// Pure, read-only. Every rule from spec §4. Returns an empty array when the
// bundle is safe to compile — never mutates or "fixes" the bundle to make
// it pass (§4: "Ne modifie jamais le bundle pour le faire passer").
export function validateBundleForCompilation(bundle) {
  const errors = [];

  if (!bundle || bundle.mode !== "dry_run") {
    errors.push(planError("INVALID_MODE", `bundle.mode must be "dry_run", got ${JSON.stringify(bundle && bundle.mode)}`));
    return errors; // nothing else is safe to inspect
  }

  if (!Array.isArray(bundle.plants) || bundle.plants.length === 0) {
    errors.push(planError("EMPTY_PLANTS", "bundle.plants is missing or empty"));
    return errors;
  }

  for (const plant of bundle.plants) {
    const label = plant && plant.input ? plant.input.name : "<unknown plant>";

    if (plant.blocked === true) {
      errors.push(planError("PLANT_BLOCKED", `${label}: plant is blocked=true, cannot compile`, { plant: label }));
      continue; // a blocked plant has no trustworthy taxonomy/catalog to validate further
    }

    if (!plant.taxonomy) {
      errors.push(planError("TAXONOMY_UNRESOLVED", `${label}: WCVP taxonomy is not resolved (taxonomy=null)`, { plant: label }));
    } else if (plant.taxonomy.taxonomic_status !== "accepted") {
      errors.push(planError("TAXONOMY_NOT_ACCEPTED", `${label}: taxonomic_status is "${plant.taxonomy.taxonomic_status}", expected "accepted"`, { plant: label }));
    }

    if (!plant.catalog) {
      errors.push(planError("CATALOG_MISSING", `${label}: catalog entry is null`, { plant: label }));
    } else {
      if (plant.catalog.publication_status !== "draft") {
        errors.push(planError("PUBLICATION_NOT_DRAFT", `${label}: publication_status is "${plant.catalog.publication_status}", expected "draft"`, { plant: label }));
      }
      if (plant.catalog.review_status !== "unreviewed") {
        errors.push(planError("REVIEW_NOT_UNREVIEWED", `${label}: review_status is "${plant.catalog.review_status}", expected "unreviewed"`, { plant: label }));
      }
      if (plant.catalog.entry_type === "cultivar" && !plant.catalog.parent_catalog_ref) {
        errors.push(planError("CULTIVAR_NO_PARENT", `${label}: cultivar entry has no parent_catalog_ref`, { plant: label }));
      }
    }

    const observationsByRef = new Map((plant.trait_observations || []).map((o) => [o.observation_ref, o]));
    const sourceRecordsByKey = new Map((plant.source_records || []).map((sr) => [`${sr.catalog_ref}:${sr.provider}`, sr]));

    for (const obs of plant.trait_observations || []) {
      if (!isInformative(obs.raw_value)) {
        errors.push(planError("NON_INFORMATIVE_RAW_VALUE", `${label}: observation ${obs.observation_ref} (${obs.trait}) has a non-informative raw_value`, { plant: label, observation_ref: obs.observation_ref }));
      }
      if (obs.provider !== "editorial") {
        const key = `${obs.catalog_ref}:${obs.provider}`;
        if (!sourceRecordsByKey.has(key)) {
          errors.push(planError("OBSERVATION_MISSING_SOURCE_RECORD", `${label}: observation ${obs.observation_ref} has no matching source_record for ${key}`, { plant: label, observation_ref: obs.observation_ref }));
        }
      }
    }

    for (const selection of plant.trait_selections || []) {
      const obs = observationsByRef.get(selection.observation_ref);
      if (!obs) {
        errors.push(planError("SELECTION_DANGLING_REF", `${label}: selection for ${selection.trait} points to unknown observation_ref ${selection.observation_ref}`, { plant: label, trait: selection.trait }));
        continue;
      }
      if (!isInformative(selection.normalized_value)) {
        errors.push(planError("SELECTION_NON_INFORMATIVE", `${label}: selection for ${selection.trait} has a non-informative normalized_value`, { plant: label, trait: selection.trait }));
      } else if (JSON.stringify(selection.normalized_value) !== JSON.stringify(obs.normalized_value)) {
        // Also structurally covers "crosswalk incomplet mais sélection quand
        // même présente": an incomplete crosswalk leaves
        // observation.normalized_value=null, and a null selection is
        // already rejected just above — a selection claiming a non-null
        // value while its observation disagrees is caught here.
        errors.push(planError("SELECTION_VALUE_MISMATCH", `${label}: selection.normalized_value for ${selection.trait} does not match its observation's normalized_value`, { plant: label, trait: selection.trait }));
      }
      if (!PROMOTABLE_CATALOG_COLUMNS.has(selection.trait)) {
        errors.push(planError("SELECTION_UNSUPPORTED_TRAIT", `${label}: selection trait "${selection.trait}" is not a supported plant_catalog column`, { plant: label, trait: selection.trait }));
      }
    }
  }

  return errors;
}
