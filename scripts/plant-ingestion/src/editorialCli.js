#!/usr/bin/env node
// Editorial curation CLI — a controlled overlay on top of the existing
// Layer A/B/C pipeline, never a replacement for it. Reads one or more
// editorial curation inputs, validates them, and reports EXACTLY what
// editorial observation(s) and manual_resolution selection(s) WOULD be
// created. DRY-RUN / VALIDATION ONLY: this CLI has no write path in this
// round, by design — see the "Apply futur" note below and README.md's
// "Curation éditoriale contrôlée" section for what a future --apply would
// reuse (unchanged Layer C helpers, never a new write path).
//
// Usage:
//   node scripts/plant-ingestion/src/editorialCli.js \
//     --input <editorial.json> \
//     [--catalog-map <transaction-plan.json>]
//
// --input accepts either a single editorial curation object or a JSON
// array of them (see README.md for the exact input format).
//
// --catalog-map is optional: pass an existing Layer B transaction plan
// (e.g. anything under scripts/plant-ingestion/output/*.json produced by
// planCli.js) so this CLI can resolve each catalog_ref to a real
// plant_catalog row and run the read-only Supabase checks. Without it, the
// CLI still validates and previews the plan fully — it just cannot check
// it against the live DB (no Supabase client is even created).
//
// Apply futur (spec §8): a future `--apply` would reuse
// apply/upsertObservations.js and apply/upsertSelections.js EXACTLY as they
// are today — both already handle provider="editorial" /
// decision_method="manual_resolution" correctly (upsertObservations.js
// already special-cases provider==="editorial" for its source_record
// lookup; upsertSelections.js already refuses to ever touch an existing
// manual_resolution row). No Layer C protection would need to be
// bypassed or modified. This round deliberately stops short of wiring that
// up — see the spec this file implements, Étape 8: "NE PAS implémenter le
// write". --apply is recognized below only so a future caller gets an
// honest message, never a silent no-op.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { validateEditorialInput } from "./editorial/validateEditorialInput.js";
import { buildEditorialPlan } from "./editorial/buildEditorialPlan.js";
import { checkEditorialPlanAgainstDb, buildCatalogSlugMap } from "./editorial/checkEditorialAgainstDb.js";
import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";

function parseArgs(argv) {
  const args = { inputPath: null, catalogMapPath: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") {
      args.inputPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--catalog-map") {
      args.catalogMapPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--apply") {
      args.apply = true;
    }
  }
  return args;
}

function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${label} not found at ${path.relative(process.cwd(), resolved)}`);
  }
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function printObservationPreview(obs) {
  console.log(`  editorial observation ${obs.observation_ref}`);
  console.log(`    normalized_value: ${JSON.stringify(obs.normalized_value)}`);
  console.log(`    source_url: ${obs.source_url}`);
  console.log(`    attribution: ${obs.attribution}`);
  console.log(`    license: ${obs.license}`);
}

function printSelectionPreview(sel) {
  console.log(`  manual_resolution -> ${sel.selected_observation_ref}`);
  if (sel.decided_by) console.log(`    decided_by: ${sel.decided_by}`);
  if (sel.note) console.log(`    note: ${sel.note}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.inputPath) {
    console.error("editorialCli — usage: node editorialCli.js --input <editorial.json> [--catalog-map <transaction-plan.json>]");
    process.exitCode = 1;
    return;
  }

  if (args.apply) {
    console.error(
      "editorialCli — --apply is not implemented in this round. This CLI is DRY-RUN / VALIDATION ONLY. " +
        "See README.md 'Curation éditoriale contrôlée' for the reuse plan (apply/upsertObservations.js + apply/upsertSelections.js, unchanged)."
    );
    process.exitCode = 1;
    return;
  }

  let raw;
  try {
    raw = readJson(args.inputPath, "input");
  } catch (err) {
    console.error(`editorialCli — ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const inputs = Array.isArray(raw) ? raw : [raw];

  console.log(`Editorial Curation CLI — DRY-RUN / VALIDATION ONLY — ${new Date().toISOString()}`);
  console.log(`${inputs.length} editorial input(s) read from ${args.inputPath}\n`);

  let hasErrors = false;
  for (const [index, input] of inputs.entries()) {
    const errors = validateEditorialInput(input);
    if (errors.length > 0) {
      hasErrors = true;
      const ref = input && typeof input === "object" ? `catalog_ref=${input.catalog_ref} trait=${input.trait}` : "<invalid input>";
      console.error(`Input #${index + 1} (${ref}) — REJECTED:`);
      for (const e of errors) console.error(`  ! [${e.code}] ${e.message}`);
    }
  }

  if (hasErrors) {
    console.error("\nAt least one input failed validation — no plan built, nothing to preview.");
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = buildEditorialPlan(inputs);
  } catch (err) {
    console.error(`editorialCli — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Plan valid — ${plan.summary.editorial_observations} editorial observation(s), ${plan.summary.manual_selections} manual_resolution selection(s):\n`);
  for (let i = 0; i < plan.editorial_observations.length; i += 1) {
    const obs = plan.editorial_observations[i];
    const sel = plan.manual_selections[i];
    console.log(`${obs.catalog_ref} / ${obs.trait}`);
    printObservationPreview(obs);
    printSelectionPreview(sel);
    console.log("");
  }

  if (!args.catalogMapPath) {
    console.log("No --catalog-map provided — skipping read-only DB checks (Supabase was never contacted). Preview above is the local plan only.");
    return;
  }

  let transactionPlan;
  try {
    transactionPlan = readJson(args.catalogMapPath, "catalog-map");
  } catch (err) {
    console.error(`editorialCli — ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const catalogSlugByRef = buildCatalogSlugMap(transactionPlan);

  const config = getSupabaseConfig();
  console.log(`SUPABASE_URL: ${config.hasUrl ? "present" : "MISSING"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${config.hasServiceRoleKey ? "present" : "MISSING"}`);
  if (!config.hasUrl || !config.hasServiceRoleKey) {
    console.error("\nSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — cannot run read-only DB checks. No client was created, nothing was read.");
    process.exitCode = 1;
    return;
  }
  const client = createSupabaseAdminClient({ url: config.url, serviceRoleKey: config.serviceRoleKey });

  console.log("\nRead-only DB checks (no write issued):");
  const checks = await checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef });
  let hasConflict = false;
  for (const check of checks) {
    const marker = check.ok ? "OK" : "CONFLICT";
    if (!check.ok) hasConflict = true;
    console.log(`  [${marker}] ${check.catalog_ref}/${check.trait} — ${check.code}: ${check.message}`);
  }

  if (hasConflict) {
    console.log("\nAt least one conflict was found above — resolve it by hand before any future --apply. Nothing was written.");
  } else {
    console.log("\nNo conflicts found. Nothing was written (dry-run only).");
  }
}

run().catch((err) => {
  console.error("Fatal editorialCli error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
