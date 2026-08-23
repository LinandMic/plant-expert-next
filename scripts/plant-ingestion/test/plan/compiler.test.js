import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileTransactionPlan } from "../../src/plan/compiler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// TEST FIXTURE ONLY — not a live bundle. Generated once from the real
// pure src/ building blocks fed with fixture provider data matching the
// already-validated live shape (see the fixture file's own comment), so
// it is internally consistent, but this is NOT a new live API call.
const FIXTURE_BUNDLE = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "acer-bloodgood-bundle.fixture.json"), "utf8"));

function planFromFixture() {
  const result = compileTransactionPlan(FIXTURE_BUNDLE);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  return result.plan;
}

// Item 18: realistic bundle -> exact summary counts 1/5/2/6/33/7. Never
// hardcoded inside the generic compiler itself — only asserted here,
// against this specific fixture.
test("18: the realistic Acer/Bloodgood fixture compiles to summary 1/5/2/6/33/7", () => {
  const plan = planFromFixture();
  assert.deepEqual(plan.summary, {
    taxa: 1,
    taxon_names: 5,
    catalog_entries: 2,
    source_records: 6,
    trait_observations: 33,
    trait_selections: 7,
  });
});

test("plan carries approval_required=true and symbolic refs only, no invented UUID", () => {
  const plan = planFromFixture();
  assert.equal(plan.approval_required, true);
  assert.equal(plan.mode, "transaction_plan");
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const t of plan.taxa) assert.ok(!uuidRe.test(t.taxon_ref));
  for (const c of plan.catalog_entries) assert.ok(!uuidRe.test(c.catalog_ref));
});

// Item 14: draft stays draft.
test("14: every catalog entry stays publication_status=draft, review_status=unreviewed", () => {
  const plan = planFromFixture();
  for (const entry of plan.catalog_entries) {
    assert.equal(entry.publication_status, "draft");
    assert.equal(entry.review_status, "unreviewed");
  }
});

// Item 15: Bloodgood's sun stays null (no sun observation/selection for it in the fixture).
test("15: Bloodgood catalog entry's sun stays null", () => {
  const plan = planFromFixture();
  const bloodgood = plan.catalog_entries.find((e) => e.entry_type === "cultivar");
  assert.equal(bloodgood.sun, null);
  const acer = plan.catalog_entries.find((e) => e.entry_type === "species");
  assert.deepEqual(acer.sun, ["full_sun", "partial_sun"]);
});

// Item 16: hardiness ranks stay null for both entries.
test("16: hardiness_min_rank/hardiness_max_rank stay null for every catalog entry", () => {
  const plan = planFromFixture();
  for (const entry of plan.catalog_entries) {
    assert.equal(entry.hardiness_min_rank, null);
    assert.equal(entry.hardiness_max_rank, null);
  }
  assert.ok(!plan.trait_selections.some((s) => s.trait === "hardiness_min_rank" || s.trait === "hardiness_max_rank"));
});

// Item 17: the 7 promotions are coherent — each selection's catalog matches.
test("17: all 7 promotions are coherent (catalog typed value == selected observation's normalized_value)", () => {
  const plan = planFromFixture();
  assert.equal(plan.trait_selections.length, 7);
  const catalogByRef = new Map(plan.catalog_entries.map((c) => [c.catalog_ref, c]));
  const obsByRef = new Map(plan.trait_observations.map((o) => [o.observation_ref, o]));
  for (const sel of plan.trait_selections) {
    const obs = obsByRef.get(sel.selected_observation_ref);
    const catalogEntry = catalogByRef.get(sel.catalog_ref);
    assert.deepEqual(catalogEntry[sel.trait], obs.normalized_value, `${sel.catalog_ref}.${sel.trait}`);
  }

  const acer = catalogByRef.get("acer_palmatum_species");
  assert.equal(acer.plant_type, "tree");
  assert.equal(acer.height_min_cm, 609.6);
  assert.equal(acer.height_max_cm, 609.6);
  const bloodgood = catalogByRef.get("acer_palmatum_bloodgood");
  assert.equal(bloodgood.plant_type, "tree");
  assert.equal(bloodgood.height_min_cm, 609.6);
  assert.equal(bloodgood.height_max_cm, 609.6);
});

test("Trefle not_found for Bloodgood: source record present, zero Trefle observations", () => {
  const plan = planFromFixture();
  const trefleBloodgoodSr = plan.source_records.find((s) => s.catalog_ref === "acer_palmatum_bloodgood" && s.provider === "trefle");
  assert.ok(trefleBloodgoodSr);
  assert.equal(trefleBloodgoodSr.provider_status, "not_found");
  assert.ok(!plan.trait_observations.some((o) => o.catalog_ref === "acer_palmatum_bloodgood" && o.provider === "trefle"));
});

test("taxonomy is deduplicated: 1 taxon shared by both catalog entries", () => {
  const plan = planFromFixture();
  assert.equal(plan.taxa.length, 1);
  assert.equal(plan.taxa[0].wcvp_taxon_id, "207798951");
  for (const entry of plan.catalog_entries) {
    assert.equal(entry.taxon_ref, plan.taxa[0].taxon_ref);
  }
});

// --- Top-level input-validation failure modes (compiler-level, not just validate.js unit) ---

test("compileTransactionPlan rejects mode !== dry_run", () => {
  const result = compileTransactionPlan({ mode: "live", plants: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVALID_MODE"));
});

test("compileTransactionPlan never mutates the input bundle", () => {
  const before = JSON.stringify(FIXTURE_BUNDLE);
  compileTransactionPlan(FIXTURE_BUNDLE);
  assert.equal(JSON.stringify(FIXTURE_BUNDLE), before);
});
