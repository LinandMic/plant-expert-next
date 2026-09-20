// Applies a common-names-batch (see scripts/plant-ingestion/editorial/
// common-names-batch-v1.json) into plant_common_names. Mirrors this
// pipeline's existing apply/*.js shape (upsertTaxonomy.js, upsertSelections.js):
// explicit select-then-insert/update per row (never a blind PostgREST
// .upsert()), dryRun gates only the write call — every read still runs for
// an accurate preview — and status is always one of
// created/updated/unchanged/failed, never silently absent.
//
// taxon_id is resolved from batch.canonical_name against the LIVE
// plant_taxa table (never created here — a common-names batch targets a
// taxon that must already exist, exactly like editorial trait
// observations target a catalog_ref that must already exist). Resolving
// by canonical_name (not by slug/catalog_id) is deliberate: a common name
// belongs to the TAXON, so acer-palmatum-bloodgood (a cultivar catalog
// entry) is never resolved or written to directly — it shares Acer
// palmatum's taxon_id automatically, by construction, since the batch
// itself has no cultivar-specific rows (see common-names-batch-v1.json's
// acer_palmatum note).
import { validateCommonNamesBatch, normalizeForCompare } from "./validateCommonNamesBatch.js";

const COMPARE_FIELDS = ["name", "is_preferred", "source_url", "source_title", "source_publisher", "curation_method"];

function commonNameRowFromBatchRow(row, taxonId) {
  return {
    taxon_id: taxonId,
    name: row.name,
    locale: row.locale,
    is_preferred: row.is_preferred,
    source_url: row.source_url ?? null,
    source_title: row.source_title ?? null,
    source_publisher: row.source_publisher ?? null,
    curation_method: row.curation_method,
    // license/curated_by/reviewed_by/reviewed_at: left to their column
    // defaults (null) — this batch's provenance fields don't carry them;
    // a future round can add and upsert them without a shape change here.
  };
}

function fieldsDiffer(existingRow, candidateRow) {
  return COMPARE_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(candidateRow[field] ?? null));
}

// resolveTaxonIds({ client, batch }) -> { idByCanonicalName, errors }
// Read-only. Never creates a plant_taxa row. An unresolved canonical_name
// is reported as an error, never silently skipped — the caller decides
// what to do (applyCommonNamesBatch below fails just that row's entries).
export async function resolveTaxonIds({ client, batch }) {
  const canonicalNames = [...new Set(batch.rows.map((r) => r.canonical_name))];
  const idByCanonicalName = new Map();
  const errors = [];

  for (const name of canonicalNames) {
    const { data, error } = await client.from("plant_taxa").select("id").eq("canonical_name", name).maybeSingle();
    if (error) {
      errors.push(`plant_taxa lookup failed for canonical_name "${name}": ${error.message}`);
      continue;
    }
    if (!data) {
      errors.push(`no plant_taxa row for canonical_name "${name}" — refusing to create a new taxon from a common-names batch`);
      continue;
    }
    idByCanonicalName.set(name, data.id);
  }

  return { idByCanonicalName, errors };
}

// applyCommonNamesBatch({ client, batch, dryRun = true }) -> report
// dryRun=true (the default): every read below (taxon resolution, existing-
// row lookup) still runs for an accurate preview; no insert/update is ever
// issued. dryRun=false: writes are issued for rows whose status is
// created/updated; unchanged/failed rows are never written, by construction.
//
// Idempotent by construction: create-vs-update is decided by comparing
// this batch's candidate row against any EXISTING plant_common_names row
// for the same (taxon_id, locale) whose DB-computed normalized_name
// matches this row's own normalizeForCompare(name) — re-running this
// function with the same batch against a DB it already fully applied
// reports everything "unchanged", never re-inserts or duplicates a row.
export async function applyCommonNamesBatch({ client, batch, dryRun = true }) {
  const validationErrors = validateCommonNamesBatch(batch);
  if (validationErrors.length > 0) {
    return { ok: false, dryRun, validationErrors, resolveErrors: [], entries: [], totals: null };
  }

  const { idByCanonicalName, errors: resolveErrors } = await resolveTaxonIds({ client, batch });

  const entries = [];

  for (const row of batch.rows) {
    const taxonId = idByCanonicalName.get(row.canonical_name);
    if (!taxonId) {
      entries.push({ taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "failed", errors: [`taxon not resolved for canonical_name "${row.canonical_name}"`] });
      continue;
    }

    const { data: existingRows, error: selectError } = await client
      .from("plant_common_names")
      .select("id, name, normalized_name, is_preferred, source_url, source_title, source_publisher, curation_method")
      .eq("taxon_id", taxonId)
      .eq("locale", row.locale);

    if (selectError) {
      entries.push({ taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "failed", errors: [`plant_common_names lookup failed for taxon ${taxonId}/${row.locale}: ${selectError.message}`] });
      continue;
    }

    const candidateNormalized = normalizeForCompare(row.name);
    const existing = (existingRows || []).find((r) => r.normalized_name === candidateNormalized);
    const candidateRow = commonNameRowFromBatchRow(row, taxonId);

    if (!existing) {
      if (dryRun) {
        entries.push({ taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "created", errors: [] });
        continue;
      }
      const { error: insertError } = await client.from("plant_common_names").insert(candidateRow);
      entries.push(
        insertError
          ? { taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "failed", errors: [`insert failed: ${insertError.message}`] }
          : { taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "created", errors: [] }
      );
      continue;
    }

    if (!fieldsDiffer(existing, candidateRow)) {
      entries.push({ taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "unchanged", errors: [] });
      continue;
    }

    if (dryRun) {
      entries.push({ taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "updated", errors: [] });
      continue;
    }
    const { error: updateError } = await client.from("plant_common_names").update(candidateRow).eq("id", existing.id);
    entries.push(
      updateError
        ? { taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "failed", errors: [`update failed: ${updateError.message}`] }
        : { taxon_ref: row.taxon_ref, locale: row.locale, name: row.name, status: "updated", errors: [] }
    );
  }

  const totals = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const entry of entries) totals[entry.status] += 1;

  const ok = resolveErrors.length === 0 && entries.every((e) => e.status !== "failed");
  return { ok, dryRun, validationErrors: [], resolveErrors, entries, totals };
}

// verifyCommonNamesBatch({ client, batch }) -> { ok, checks }
// Read-only, independent of applyCommonNamesBatch's own bookkeeping — same
// role as editorial/verifyEditorialPlan.js. Re-reads the LIVE table (after
// a real --apply) and re-derives the two invariants the DB's own
// constraints already enforce, so a check failure here would mean the
// constraints themselves were bypassed or this batch's assumptions were
// wrong — never redundant with them, a genuine independent cross-check:
//   1. every row this batch marked is_preferred=true is_preferred=true live
//   2. no (taxon_id, locale) has more than one is_preferred=true row live
export async function verifyCommonNamesBatch({ client, batch }) {
  const { idByCanonicalName, errors: resolveErrors } = await resolveTaxonIds({ client, batch });
  const checks = resolveErrors.map((message) => ({ ok: false, message }));

  const taxonLocalePairs = [...new Set(batch.rows.map((r) => `${r.canonical_name}|${r.locale}`))];

  for (const pair of taxonLocalePairs) {
    const [canonicalName, locale] = pair.split("|");
    const taxonId = idByCanonicalName.get(canonicalName);
    if (!taxonId) continue; // already reported by resolveErrors above

    const { data, error } = await client.from("plant_common_names").select("id, name, is_preferred").eq("taxon_id", taxonId).eq("locale", locale);
    if (error) {
      checks.push({ ok: false, message: `plant_common_names read failed for ${canonicalName}/${locale}: ${error.message}` });
      continue;
    }

    const preferredRows = (data || []).filter((r) => r.is_preferred);
    const batchExpectsPreferred = batch.rows.some((r) => r.canonical_name === canonicalName && r.locale === locale && r.is_preferred);

    checks.push({
      ok: preferredRows.length <= 1,
      message: `${canonicalName}/${locale}: ${preferredRows.length} preferred row(s) live (expected at most 1)`,
    });
    checks.push({
      ok: !batchExpectsPreferred || preferredRows.length === 1,
      message: `${canonicalName}/${locale}: batch expects a preferred name — ${preferredRows.length === 1 ? "present" : "MISSING"} live`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
