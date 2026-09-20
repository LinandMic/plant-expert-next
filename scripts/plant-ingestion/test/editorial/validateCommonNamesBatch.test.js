import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCommonNamesBatch, summarizeCoverage, normalizeForCompare } from "../../src/editorial/validateCommonNamesBatch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH_PATH = path.resolve(__dirname, "..", "..", "editorial", "common-names-batch-v1.json");

function baseRow(overrides = {}) {
  return {
    taxon_ref: "acer_campestre",
    canonical_name: "Acer campestre",
    locale: "fr",
    name: "Érable champêtre",
    is_preferred: true,
    source_url: "https://inpn.mnhn.fr/espece/cd_nom/79734",
    source_title: "Acer campestre",
    source_publisher: "INPN",
    curation_method: "open_source_synthesis",
    ...overrides,
  };
}

test("normalizeForCompare: case- and accent-folds, matching the DB's generated column intent", () => {
  assert.equal(normalizeForCompare("Érable champêtre"), normalizeForCompare("erable champetre"));
  assert.equal(normalizeForCompare("LAVANDE"), normalizeForCompare("lavande"));
  assert.equal(normalizeForCompare("  Fougère-mâle  "), normalizeForCompare("fougere-male"));
});

test("validateCommonNamesBatch: a single well-formed row passes with zero errors", () => {
  const errors = validateCommonNamesBatch({ rows: [baseRow()] });
  assert.deepEqual(errors, []);
});

test("validateCommonNamesBatch: rejects an invalid locale", () => {
  const errors = validateCommonNamesBatch({ rows: [baseRow({ locale: "de" })] });
  assert.ok(errors.some((e) => e.code === "LOCALE_INVALID"));
});

test("validateCommonNamesBatch: rejects open_source_synthesis with no source_url — no unsourced names", () => {
  const errors = validateCommonNamesBatch({ rows: [baseRow({ source_url: null })] });
  assert.ok(errors.some((e) => e.code === "SOURCE_URL_MISSING"));
});

test("validateCommonNamesBatch: expert_knowledge is allowed without a source_url", () => {
  const errors = validateCommonNamesBatch({ rows: [baseRow({ source_url: null, source_title: null, source_publisher: null, curation_method: "expert_knowledge" })] });
  assert.deepEqual(errors, []);
});

test("validateCommonNamesBatch: rejects curation_method=restricted_source_paraphrase — schema-ready, not product-enabled", () => {
  const errors = validateCommonNamesBatch({ rows: [baseRow({ curation_method: "restricted_source_paraphrase" })] });
  assert.ok(errors.some((e) => e.code === "CURATION_METHOD_NOT_ENABLED"));
});

test("validateCommonNamesBatch: rejects a duplicate (taxon_ref, locale, normalized name) even with different case/accents", () => {
  const errors = validateCommonNamesBatch({
    rows: [baseRow({ name: "Érable champêtre", is_preferred: true }), baseRow({ name: "erable champetre", is_preferred: false })],
  });
  assert.ok(errors.some((e) => e.code === "DUPLICATE_NORMALIZED_NAME"));
});

test("validateCommonNamesBatch: rejects a second is_preferred=true for the same taxon+locale", () => {
  const errors = validateCommonNamesBatch({
    rows: [baseRow({ name: "Érable champêtre", is_preferred: true }), baseRow({ name: "Acéraille", is_preferred: true })],
  });
  assert.ok(errors.some((e) => e.code === "MULTIPLE_PREFERRED"));
});

test("validateCommonNamesBatch: a non-preferred alternate alongside a preferred name is allowed", () => {
  const errors = validateCommonNamesBatch({
    rows: [baseRow({ name: "Érable champêtre", is_preferred: true }), baseRow({ name: "Acéraille", is_preferred: false })],
  });
  assert.deepEqual(errors, []);
});

test("validateCommonNamesBatch: the SAME name is allowed for the same taxon in two different locales (fr vs en)", () => {
  const errors = validateCommonNamesBatch({
    rows: [baseRow({ locale: "fr", name: "Ginkgo", is_preferred: true }), baseRow({ locale: "en", name: "Ginkgo", is_preferred: true })],
  });
  assert.deepEqual(errors, []);
});

test("validateCommonNamesBatch: rejects a missing/empty rows array", () => {
  assert.ok(validateCommonNamesBatch({ rows: [] }).some((e) => e.code === "ROWS_MISSING"));
  assert.ok(validateCommonNamesBatch({}).some((e) => e.code === "ROWS_MISSING"));
  assert.ok(validateCommonNamesBatch(null).some((e) => e.code === "INVALID_BATCH"));
});

test("summarizeCoverage: flags a taxon with no preferred fr/en name", () => {
  const batch = { rows: [baseRow({ taxon_ref: "acer_campestre", locale: "fr", is_preferred: true })] };
  const coverage = summarizeCoverage(batch, ["acer_campestre"]);
  assert.deepEqual(coverage.missingFrPreferred, []);
  assert.deepEqual(coverage.missingEnPreferred, ["acer_campestre"]);
});

test("summarizeCoverage: a fully-covered taxon is flagged in neither list", () => {
  const batch = {
    rows: [baseRow({ taxon_ref: "acer_campestre", locale: "fr", is_preferred: true }), baseRow({ taxon_ref: "acer_campestre", locale: "en", name: "Field maple", is_preferred: true })],
  };
  const coverage = summarizeCoverage(batch, ["acer_campestre"]);
  assert.deepEqual(coverage.missingFrPreferred, []);
  assert.deepEqual(coverage.missingEnPreferred, []);
});

// ---------------------------------------------------------------------------
// The real, repo-tracked batch file — this is the actual deliverable this
// round produced, not a synthetic fixture. Regressions here mean the batch
// itself (scripts/plant-ingestion/editorial/common-names-batch-v1.json) is
// broken, not just this test's fixtures.
test("common-names-batch-v1.json: the real tracked batch passes validation with zero errors", () => {
  const batch = JSON.parse(readFileSync(BATCH_PATH, "utf8"));
  const errors = validateCommonNamesBatch(batch);
  assert.deepEqual(errors, []);
});

test("common-names-batch-v1.json: covers exactly 21 distinct taxa, each with a preferred fr and en name", () => {
  const batch = JSON.parse(readFileSync(BATCH_PATH, "utf8"));
  const taxonRefs = [...new Set(batch.rows.map((r) => r.taxon_ref))];
  assert.equal(taxonRefs.length, 21);
  const coverage = summarizeCoverage(batch, taxonRefs);
  assert.deepEqual(coverage.missingFrPreferred, []);
  assert.deepEqual(coverage.missingEnPreferred, []);
});

test("common-names-batch-v1.json: never carries a row for the Acer palmatum 'Bloodgood' cultivar — it shares the species taxon", () => {
  const batch = JSON.parse(readFileSync(BATCH_PATH, "utf8"));
  const bloodgoodRows = batch.rows.filter((r) => /bloodgood/i.test(r.taxon_ref) || /bloodgood/i.test(r.canonical_name || ""));
  assert.deepEqual(bloodgoodRows, []);
});
