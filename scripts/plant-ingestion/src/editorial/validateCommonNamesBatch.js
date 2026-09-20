// Pure validation for a common-names-batch (schema_version=
// "common_names_batch_v1", see scripts/plant-ingestion/editorial/
// common-names-batch-v1.json). No DB, no network, no file access — safe to
// unit test in isolation, same discipline as validateEditorialInput.js.
import { planError } from "../plan/errors.js";

export const SUPPORTED_LOCALES = ["fr", "en"];

// Same vocabulary/enablement split as editorialVocab.js's
// CURATION_METHODS_SCHEMA / CURATION_METHODS_ENABLED: the DB schema (see
// plant_common_names_curation_method_check) accepts all 3, this pipeline's
// application layer accepts only 2 — "restricted_source_paraphrase" is
// schema-ready but not product-enabled, and is rejected explicitly rather
// than silently downgraded or silently accepted.
export const CURATION_METHODS_SCHEMA = ["expert_knowledge", "open_source_synthesis", "restricted_source_paraphrase"];
export const CURATION_METHODS_ENABLED = ["expert_knowledge", "open_source_synthesis"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// normalizeForCompare(name) -> lower + diacritic-stripped.
// A JS-side APPROXIMATION of the DB's generated normalized_name column
// (lower(public.immutable_unaccent(name)) — see supabase/migrations/
// 20260911140000_add_plant_common_names_v1.sql). Used only so this
// validator (and applyCommonNamesBatch.js) can catch an obvious duplicate
// or resolve create-vs-update BEFORE touching the DB; the DB's own
// generated column + unique constraint (plant_common_names_taxon_locale_
// normalized_name_unique) remains the real source of truth and would
// reject anything this approximation missed — this can under-detect
// (rare Unicode edge cases), never silently corrupt data, since a missed
// duplicate would surface as a real insert error, not a silent double-row.
export function normalizeForCompare(name) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// validateCommonNamesBatch(batch) -> planError[]
// Empty return means every row is internally self-consistent: locale
// whitelist, non-empty required fields, curation_method enabled +
// source_url present whenever a real external source is claimed (no
// unsourced names — mirrors validateEditorialInput.js's own
// validateSourceForOpenSourceSynthesis), no duplicate (taxon_ref, locale,
// normalized name) within the batch, and at most one is_preferred=true per
// (taxon_ref, locale). This does NOT check anything against the live DB
// (no taxon resolution, no existing-row comparison) — see
// applyCommonNamesBatch.js for that.
export function validateCommonNamesBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    return [planError("INVALID_BATCH", "batch must be a JSON object")];
  }
  if (!Array.isArray(batch.rows) || batch.rows.length === 0) {
    return [planError("ROWS_MISSING", "batch.rows must be a non-empty array")];
  }

  const errors = [];
  const seenNormalized = new Map(); // "taxon_ref|locale|normalized" -> row index
  const preferredSeen = new Map(); // "taxon_ref|locale" -> row index

  batch.rows.forEach((row, index) => {
    const r = row && typeof row === "object" ? row : {};
    const label = `row #${index + 1} (${r.taxon_ref ?? "?"}/${r.locale ?? "?"}/"${r.name ?? "?"}")`;

    const taxonRefOk = isNonEmptyString(r.taxon_ref);
    if (!taxonRefOk) errors.push(planError("TAXON_REF_MISSING", `${label}: taxon_ref is required`));

    if (!isNonEmptyString(r.canonical_name)) {
      errors.push(planError("CANONICAL_NAME_MISSING", `${label}: canonical_name is required (used to resolve taxon_id via plant_taxa.canonical_name)`));
    }

    const localeOk = SUPPORTED_LOCALES.includes(r.locale);
    if (!localeOk) errors.push(planError("LOCALE_INVALID", `${label}: locale must be one of ${SUPPORTED_LOCALES.join(", ")}, got ${JSON.stringify(r.locale)}`));

    const nameOk = isNonEmptyString(r.name);
    if (!nameOk) errors.push(planError("NAME_MISSING", `${label}: name is required and must be a non-empty string`));

    if (typeof r.is_preferred !== "boolean") {
      errors.push(planError("IS_PREFERRED_INVALID", `${label}: is_preferred must be a boolean`));
    }

    if (!isNonEmptyString(r.curation_method) || !CURATION_METHODS_SCHEMA.includes(r.curation_method)) {
      errors.push(planError("CURATION_METHOD_INVALID", `${label}: curation_method must be one of ${CURATION_METHODS_SCHEMA.join(", ")}`));
    } else if (!CURATION_METHODS_ENABLED.includes(r.curation_method)) {
      errors.push(planError("CURATION_METHOD_NOT_ENABLED", `${label}: curation_method "${r.curation_method}" is schema-ready but not yet enabled by this tool`));
    } else if (r.curation_method === "open_source_synthesis" && !isNonEmptyString(r.source_url)) {
      // No unsourced names, ever: an open_source_synthesis row claims a
      // real external source was consulted, so it must actually cite one.
      errors.push(planError("SOURCE_URL_MISSING", `${label}: source_url is required for curation_method=open_source_synthesis`));
    }

    if (taxonRefOk && localeOk && nameOk) {
      const normKey = `${r.taxon_ref}|${r.locale}|${normalizeForCompare(r.name)}`;
      if (seenNormalized.has(normKey)) {
        errors.push(planError("DUPLICATE_NORMALIZED_NAME", `${label}: duplicates row #${seenNormalized.get(normKey) + 1} after case/accent-folding (taxon_ref+locale+normalized name must be unique)`));
      } else {
        seenNormalized.set(normKey, index);
      }

      if (r.is_preferred === true) {
        const prefKey = `${r.taxon_ref}|${r.locale}`;
        if (preferredSeen.has(prefKey)) {
          errors.push(planError("MULTIPLE_PREFERRED", `${label}: a second is_preferred=true row for ${prefKey} — row #${preferredSeen.get(prefKey) + 1} already claimed it. Max one preferred per taxon+locale.`));
        } else {
          preferredSeen.set(prefKey, index);
        }
      }
    }
  });

  return errors;
}

// summarizeCoverage(batch, requiredTaxonRefs) -> { missingFrPreferred, missingEnPreferred }
// Reports which of the given taxon_refs have NO is_preferred=true row for
// fr/en in this batch — the "21/21 taxa have a preferred name" check, as a
// reusable function rather than a one-off script.
export function summarizeCoverage(batch, requiredTaxonRefs) {
  const preferredKeys = new Set();
  for (const row of batch.rows || []) {
    if (row && row.is_preferred === true && row.taxon_ref && row.locale) {
      preferredKeys.add(`${row.taxon_ref}|${row.locale}`);
    }
  }
  const missingFrPreferred = requiredTaxonRefs.filter((ref) => !preferredKeys.has(`${ref}|fr`));
  const missingEnPreferred = requiredTaxonRefs.filter((ref) => !preferredKeys.has(`${ref}|en`));
  return { missingFrPreferred, missingEnPreferred };
}
