import { isInformative } from "../informative.js";
import { planError } from "../plan/errors.js";
import { PROMOTABLE_CATALOG_COLUMNS } from "../plan/catalogColumns.js";
import { TRAIT_KINDS, EDITORIAL_SCHEMA_VERSION, CURATION_METHODS_ENABLED } from "./editorialVocab.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isForbiddenPlaceholderLicense(value) {
  return value.trim().toLowerCase() === "unknown";
}

function isValidTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
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

// validateCuration(curation) -> planError[]
// Requires curation.method to be one of CURATION_METHODS_ENABLED — never
// CURATION_METHODS_SCHEMA at large: "restricted_source_paraphrase" is
// schema-ready (see the migration) but not product-enabled yet, and is
// rejected explicitly rather than silently accepted or silently
// downgraded. curation.license is always required, and "unknown" is
// never accepted for it either — same placeholder-license rule as
// source.license, for the same reason (an apply-blocking placeholder must
// never be a valid answer).
function validateCuration(curation) {
  const errors = [];
  const c = curation && typeof curation === "object" ? curation : {};

  if (!isNonEmptyString(c.method)) {
    errors.push(planError("CURATION_METHOD_MISSING", "curation.method is required and must be a non-empty string"));
  } else if (c.method === "restricted_source_paraphrase") {
    errors.push(planError("CURATION_METHOD_NOT_ENABLED", 'curation.method "restricted_source_paraphrase" is schema-ready but not yet enabled by this tool'));
  } else if (!CURATION_METHODS_ENABLED.includes(c.method)) {
    errors.push(planError("CURATION_METHOD_INVALID", `curation.method "${c.method}" is not recognized (enabled: ${CURATION_METHODS_ENABLED.join(", ")})`));
  }

  if (!isNonEmptyString(c.license)) {
    errors.push(planError("CURATION_LICENSE_MISSING", "curation.license is required"));
  } else if (isForbiddenPlaceholderLicense(c.license)) {
    errors.push(planError("CURATION_LICENSE_UNKNOWN_NOT_ALLOWED", 'curation.license "unknown" is never accepted — a placeholder license blocks this observation from ever being apply-eligible'));
  }

  return errors;
}

// validateSourceForOpenSourceSynthesis(source) -> planError[]
// Every field required, including retrieved_at (new in schema v2 — an
// open_source_synthesis curation genuinely consulted a source at a real
// point in time, and the DB now allows recording it, see the migration's
// relaxed editorial_coherence_check).
function validateSourceForOpenSourceSynthesis(source) {
  const errors = [];
  const s = source && typeof source === "object" ? source : {};

  if (!isNonEmptyString(s.url)) errors.push(planError("SOURCE_URL_MISSING", "source.url is required for curation.method=open_source_synthesis"));
  if (!isNonEmptyString(s.title)) errors.push(planError("SOURCE_TITLE_MISSING", "source.title is required for curation.method=open_source_synthesis"));
  if (!isNonEmptyString(s.publisher)) errors.push(planError("SOURCE_PUBLISHER_MISSING", "source.publisher is required for curation.method=open_source_synthesis"));
  if (!isNonEmptyString(s.license)) {
    errors.push(planError("SOURCE_LICENSE_MISSING", "source.license is required for curation.method=open_source_synthesis"));
  } else if (isForbiddenPlaceholderLicense(s.license)) {
    errors.push(planError("SOURCE_LICENSE_UNKNOWN_NOT_ALLOWED", 'source.license "unknown" is never accepted — a placeholder license blocks this observation from ever being apply-eligible'));
  }
  if (!isValidTimestamp(s.retrieved_at)) {
    errors.push(planError("SOURCE_RETRIEVED_AT_MISSING", "source.retrieved_at is required for curation.method=open_source_synthesis and must be a valid timestamp"));
  }

  return errors;
}

// validateEditorialInput(input) -> planError[]
// Pure. No DB, no network, no file access — never mutates `input`. An
// empty return means the input is safe to hand to
// buildEditorialObservation(). schema_version=2: requires an explicit
// `curation` object naming its method, and restructures `source` to be
// either a fully-populated object (open_source_synthesis) or exactly
// `null` (expert_knowledge, spec: "ne jamais fabriquer une fausse
// source") — never a partially-filled or implicit shape.
export function validateEditorialInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [planError("INVALID_INPUT", "editorial input must be a JSON object")];
  }

  const errors = [];

  if (input.schema_version !== EDITORIAL_SCHEMA_VERSION) {
    // Reject clearly rather than guessing at an old (schema_version=1 /
    // absent) input's intent — see editorialVocab.js's EDITORIAL_SCHEMA_
    // VERSION comment. Every other check below still runs (so a curator
    // migrating an old file sees every problem in one pass), but this
    // error alone is enough to block the input.
    errors.push(planError("SCHEMA_VERSION_UNSUPPORTED", `schema_version must be ${EDITORIAL_SCHEMA_VERSION}, got ${JSON.stringify(input.schema_version)} — old editorial inputs are never silently reinterpreted, re-express them in the current format`));
  }

  if (!isNonEmptyString(input.catalog_ref)) {
    errors.push(planError("CATALOG_REF_MISSING", "catalog_ref is required and must be a non-empty string"));
  }

  const trait = input.trait;
  let traitOk = false;
  if (!isNonEmptyString(trait)) {
    errors.push(planError("TRAIT_MISSING", "trait is required and must be a non-empty string"));
  } else if (trait === "soil") {
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

  errors.push(...validateCuration(input.curation));
  const method = input.curation && typeof input.curation === "object" ? input.curation.method : undefined;

  if (method === "expert_knowledge") {
    if (input.source !== null && input.source !== undefined) {
      // Spec §4: "ne jamais fabriquer une fausse source" — a source
      // object present alongside curation.method=expert_knowledge would
      // contradict the method's own declaration (no external source
      // consulted), so it is rejected rather than silently ignored.
      errors.push(planError("SOURCE_MUST_BE_NULL_FOR_EXPERT_KNOWLEDGE", "source must be null when curation.method=expert_knowledge — no external source was consulted"));
    }
    const review = input.review && typeof input.review === "object" ? input.review : {};
    if (!isNonEmptyString(review.note)) {
      errors.push(planError("REVIEW_NOTE_MISSING", "review.note is required for curation.method=expert_knowledge"));
    }
  } else if (method === "open_source_synthesis") {
    errors.push(...validateSourceForOpenSourceSynthesis(input.source));
  }
  // method missing/invalid/not-enabled: already reported by
  // validateCuration() above — no source-shape check is meaningful
  // without knowing which shape it should have.

  return errors;
}
