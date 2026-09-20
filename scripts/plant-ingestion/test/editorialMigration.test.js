import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Static, textual regression guard on the editorial provenance migration
// (supabase/migrations/20260902100000_add_editorial_provenance_v1.sql).
// This is NOT a substitute for actually running the migration — that was
// done once, manually, against a disposable local PostgreSQL 16 database
// (never Supabase) as part of this chantier: the two plant_catalog
// migrations were applied, pre-migration provider/editorial rows were
// seeded, this migration was applied on top, and both the untouched old
// rows and new insert shapes (with/without source_retrieved_at, valid and
// invalid curation_method) were verified directly with psql. This test
// only guards against a future edit silently turning the migration
// destructive (a dropped/renamed column, a rewritten row) — it re-reads
// the file itself, never a database.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(__dirname, "..", "..", "..", "supabase", "migrations", "20260902100000_add_editorial_provenance_v1.sql");

function readMigration() {
  return readFileSync(MIGRATION_PATH, "utf8");
}

test("editorial provenance migration file exists", () => {
  assert.doesNotThrow(() => readMigration());
});

test("migration is additive only: no DROP COLUMN, no RENAME, no UPDATE/DELETE on existing rows", () => {
  const sql = readMigration().toLowerCase();
  assert.doesNotMatch(sql, /drop column/);
  assert.doesNotMatch(sql, /rename column/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.plant_trait_observations\b/);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/);
  assert.doesNotMatch(sql, /\btruncate\b/);
});

test("migration adds exactly the 7 specified provenance columns", () => {
  const sql = readMigration();
  for (const column of ["source_title text null", "source_publisher text null", "curation_license text null", "curated_by uuid null", "curation_method text null", "reviewed_by uuid null", "reviewed_at timestamptz null"]) {
    assert.ok(sql.includes(column), `expected migration to add column: ${column}`);
  }
});

test("migration adds a curation_method CHECK constraint covering all 3 schema-level values, including the not-yet-enabled one", () => {
  const sql = readMigration();
  assert.ok(sql.includes("plant_trait_observations_curation_method_check"));
  for (const value of ["expert_knowledge", "open_source_synthesis", "restricted_source_paraphrase"]) {
    assert.ok(sql.includes(`'${value}'`), `expected the CHECK constraint to list '${value}'`);
  }
});

test("migration relaxes (never removes) the editorial coherence check: source_retrieved_at is no longer forced null for editorial rows", () => {
  const sql = readMigration();
  // The OLD constraint (dropped here) forced `source_retrieved_at is null`
  // in its editorial branch — the new constraint (re-added under the same
  // name) must NOT carry that clause anymore, while every other coherence
  // clause (provider/source_scope/plant_source_record_id) is preserved.
  const dropIndex = sql.indexOf("drop constraint plant_trait_observations_editorial_coherence_check");
  const addIndex = sql.indexOf("add constraint\n    check", dropIndex);
  assert.ok(dropIndex !== -1, "expected the old constraint to be explicitly dropped");
  const newConstraintBlock = sql.slice(dropIndex, sql.length);
  assert.ok(newConstraintBlock.includes("plant_source_record_id is null"), "editorial rows must still require plant_source_record_id IS NULL");
  // The re-added constraint's editorial branch must not re-impose "source_retrieved_at is null".
  const editorialBranch = newConstraintBlock.slice(newConstraintBlock.indexOf("provider = 'editorial'"), newConstraintBlock.indexOf(")\n      or"));
  assert.doesNotMatch(editorialBranch, /source_retrieved_at is null/);
});
