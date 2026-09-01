import { isInformative } from "../informative.js";
import { planError } from "../plan/errors.js";
import { PROMOTABLE_CATALOG_COLUMNS } from "../plan/catalogColumns.js";
import { TRAIT_KINDS } from "./editorialVocab.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// validateValueShape(trait, value) -> string[]
// Pure. Shape rules per TRAIT_KINDS — never invents a vocabulary beyond
// what that map declares (growth_form/water_need only get a non-empty
// string check, on purpose — see editorialVocab.js).
function validateValueShape(trait, value) {
  const spec = TRAIT_KINDS[trait];
  const errors = [];

  switch (spec.kind) {
    case "enum":
      if (!spec.values.includes(value)) {
        errors.push(`"${value}" is not in the known vocabulary for ${trait} (${spec.values.join(", ")})`);
      }
      break;
    case "enum_array":
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${trait} must be a non-empty array`);
        break;
      }
      for (const v of value) {
        if (!spec.values.includes(v)) errors.push(`"${v}" is not in the known vocabulary for ${trait} (${spec.values.join(", ")})`);
      }
      break;
    case "int_array":
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${trait} must be a non-empty array`);
        break;
      }
      for (const v of value) {
        if (!Number.isInteger(v) || v < spec.min || v > spec.max) {
          errors.push(`${trait} value ${JSON.stringify(v)} must be an integer between ${spec.min} and ${spec.max}`);
        }
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${trait} must be a boolean, got ${JSON.stringify(value)}`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || value < spec.min) {
        errors.push(`${trait} must be a number >= ${spec.min}, got ${JSON.stringify(value)}`);
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) errors.push(`${trait} must be an integer, got ${JSON.stringify(value)}`);
      break;
    case "string":
      if (!isNonEmptyString(value)) errors.push(`${trait} must be a non-empty string`);
      break;
    default:
      errors.push(`${trait}: no validation rule defined (internal — should never happen for a PROMOTABLE_CATALOG_COLUMNS trait)`);
  }

  return errors;
}

// validateEditorialInput(input) -> planError[]
// Pure. No DB, no network, no file access — never mutates `input`. An empty
// return means the input is safe to hand to buildEditorialObservation().
// Every rule from the "OUTIL DE CURATION ÉDITORIALE" spec §2 is checked
// explicitly and independently — a rejection never masks another one, the
// caller sees every problem in one pass rather than fixing them one at a
// time.
export function validateEditorialInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [planError("INVALID_INPUT", "editorial input must be a JSON object")];
  }

  const errors = [];

  if (!isNonEmptyString(input.catalog_ref)) {
    errors.push(planError("CATALOG_REF_MISSING", "catalog_ref is required and must be a non-empty string"));
  }

  const trait = input.trait;
  let traitOk = false;
  if (!isNonEmptyString(trait)) {
    errors.push(planError("TRAIT_MISSING", "trait is required and must be a non-empty string"));
  } else if (trait === "soil") {
    // Explicit, distinct rejection: "soil" is not merely unsupported like an
    // unknown trait name would be — plant_catalog has NO soil column at
    // all (confirmed against the real migration), so this is called out on
    // its own rather than folded into the generic TRAIT_NOT_PROMOTABLE case.
    errors.push(planError("TRAIT_SOIL_NOT_SUPPORTED", 'trait "soil" has no plant_catalog column — out of scope until a migration adds one'));
  } else if (!PROMOTABLE_CATALOG_COLUMNS.has(trait)) {
    errors.push(planError("TRAIT_NOT_PROMOTABLE", `trait "${trait}" is not a supported plant_catalog column`));
  } else {
    traitOk = true;
  }

  if (!isInformative(input.raw_value)) {
    errors.push(planError("RAW_VALUE_NOT_INFORMATIVE", "raw_value must be informative (not null/undefined/[]/\"\")"));
  }

  if (!isInformative(input.normalized_value)) {
    errors.push(planError("NORMALIZED_VALUE_NOT_INFORMATIVE", "normalized_value must be informative (not null/undefined/[]/\"\")"));
  } else if (traitOk) {
    for (const message of validateValueShape(trait, input.normalized_value)) {
      errors.push(planError("NORMALIZED_VALUE_INVALID", message));
    }
  }

  const source = input.source && typeof input.source === "object" ? input.source : {};
  if (!isNonEmptyString(source.url)) errors.push(planError("SOURCE_URL_MISSING", "source.url is required"));
  if (!isNonEmptyString(source.title)) errors.push(planError("SOURCE_TITLE_MISSING", "source.title is required"));
  if (!isNonEmptyString(source.publisher)) errors.push(planError("SOURCE_PUBLISHER_MISSING", "source.publisher is required"));
  if (!isNonEmptyString(source.license)) {
    errors.push(planError("SOURCE_LICENSE_MISSING", "source.license is required"));
  } else if (source.license.trim().toLowerCase() === "unknown") {
    // "obligatoire OU explicitement 'unknown' interdit pour apply" — a
    // placeholder license is never accepted, not even for a dry-run
    // preview: the dry-run preview must show exactly what would (and would
    // not) ever be eligible for a future --apply.
    errors.push(planError("SOURCE_LICENSE_UNKNOWN_NOT_ALLOWED", 'source.license "unknown" is never accepted — a placeholder license blocks this observation from ever being apply-eligible'));
  }

  return errors;
}
