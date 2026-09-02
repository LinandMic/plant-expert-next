#!/usr/bin/env node
// Editorial curation CLI — a controlled overlay on top of the existing
// Layer A/B/C pipeline, never a replacement for it. Reads one or more
// editorial curation inputs, validates them, and either previews (default)
// or actually applies (--apply) the resulting editorial observation(s) and
// manual_resolution selection(s), including promotion into plant_catalog.
//
// Usage:
//   node scripts/plant-ingestion/src/editorialCli.js \
//     --input <editorial.json> \
//     [--catalog-map <transaction-plan.json>] \
//     [--apply] [--verify]
//
// --input accepts either a single editorial curation object or a JSON
// array of them (see README.md for the exact input format).
//
// --catalog-map: an existing Layer B transaction plan (e.g. anything under
// scripts/plant-ingestion/output/*.json produced by planCli.js), used only
// to extract (catalog_ref, slug) pairs — the ONLY faithful way to resolve
// a symbolic catalog_ref to a real plant_catalog row without ever
// re-deriving a slug from scratch (see editorial/checkEditorialAgainstDb.js).
// Required for DB checks, --apply, and --verify; without it, the CLI still
// validates and previews the local plan, but performs no Supabase read.
//
// Without --apply: DRY-RUN. Every read that --apply would perform still
// runs (an accurate preview), nothing is ever written.
// With --apply: writes editorial observations, manual_resolution
// selections, and promotes into plant_catalog — see
// editorial/applyEditorialPlan.js for the exact per-entry pipeline and
// its protections. Requires --catalog-map.
//
// With --verify: read-only cross-check against the live DB (never writes),
// independent of applyEditorialPlan()'s own bookkeeping. Requires
// --catalog-map. Mutually exclusive with --apply.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { validateEditorialInput } from "./editorial/validateEditorialInput.js";
import { buildEditorialPlan } from "./editorial/buildEditorialPlan.js";
import { buildCatalogSlugMap } from "./editorial/checkEditorialAgainstDb.js";
import { applyEditorialPlan } from "./editorial/applyEditorialPlan.js";
import { verifyEditorialPlan } from "./editorial/verifyEditorialPlan.js";
import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";

function parseArgs(argv) {
  const args = { inputPath: null, catalogMapPath: null, apply: false, verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") {
      args.inputPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--catalog-map") {
      args.catalogMapPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--apply") {
      args.apply = true;
    } else if (argv[i] === "--verify") {
      args.verify = true;
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
  console.log(`    curation_method: ${obs.curation_method}`);
  console.log(`    curation_license: ${obs.curation_license}`);
  if (obs.curation_method === "expert_knowledge") {
    console.log("    source: none (expert_knowledge — no external source consulted)");
  } else {
    console.log(`    source_title: ${obs.source_title}`);
    console.log(`    source_publisher: ${obs.source_publisher}`);
    console.log(`    source_url: ${obs.source_url}`);
    console.log(`    source license: ${obs.license}`);
    console.log(`    source_retrieved_at: ${obs.source_retrieved_at}`);
  }
}

function printSelectionPreview(sel) {
  console.log(`  manual_resolution -> ${sel.selected_observation_ref}`);
  if (sel.decided_by) console.log(`    decided_by: ${sel.decided_by}`);
  if (sel.note) console.log(`    note: ${sel.note}`);
}

function printApplyReport(report) {
  console.log(`\n${report.dryRun ? "DRY-RUN report (nothing written)" : "APPLY report (writes performed)"}:\n`);
  for (const entry of report.entries) {
    console.log(`${entry.catalog_ref} / ${entry.trait}`);
    if (entry.errors.length > 0) {
      for (const e of entry.errors) console.log(`  ! ${e}`);
    }
    if (entry.observation) {
      console.log(`  observation: ${entry.observation.status}${entry.observation.errors.length ? ` — ${entry.observation.errors.join("; ")}` : ""}`);
    }
    if (entry.selection) {
      console.log(`  selection:   ${entry.selection.status}${entry.selection.errors.length ? ` — ${entry.selection.errors.join("; ")}` : ""}`);
    }
    if (entry.promotion) {
      console.log(`  promotion:   ${entry.promotion.status}${entry.promotion.errors.length ? ` — ${entry.promotion.errors.join("; ")}` : ""}`);
    } else {
      console.log("  promotion:   skipped");
    }
  }

  const t = report.totals;
  console.log("\nTOTAL");
  console.log(`  editorial_observations: created=${t.editorial_observations.created} unchanged=${t.editorial_observations.unchanged} failed=${t.editorial_observations.failed}`);
  console.log(`  manual_selections:      created=${t.manual_selections.created} updated=${t.manual_selections.updated} unchanged=${t.manual_selections.unchanged} conflicts=${t.manual_selections.conflicts} failed=${t.manual_selections.failed}`);
  console.log(`  catalog_promotions:     updated=${t.catalog_promotions.updated} unchanged=${t.catalog_promotions.unchanged} skipped=${t.catalog_promotions.skipped} failed=${t.catalog_promotions.failed}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.inputPath) {
    console.error("editorialCli — usage: node editorialCli.js --input <editorial.json> [--catalog-map <transaction-plan.json>] [--apply] [--verify]");
    process.exitCode = 1;
    return;
  }
  if (args.apply && args.verify) {
    console.error("editorialCli — --apply and --verify are mutually exclusive.");
    process.exitCode = 1;
    return;
  }
  if ((args.apply || args.verify) && !args.catalogMapPath) {
    console.error("editorialCli — --apply and --verify both require --catalog-map (to resolve catalog_ref -> plant_catalog.id).");
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

  console.log(`Editorial Curation CLI — ${args.apply ? "APPLY" : args.verify ? "VERIFY (read-only)" : "DRY-RUN / VALIDATION ONLY"} — ${new Date().toISOString()}`);
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
    const sel = plan.manual_selections.find((s) => s.selected_observation_ref === obs.observation_ref);
    console.log(`${obs.catalog_ref} / ${obs.trait}`);
    printObservationPreview(obs);
    if (sel) printSelectionPreview(sel);
    console.log("");
  }

  if (!args.catalogMapPath) {
    console.log("No --catalog-map provided — local plan preview only, nothing was checked against Supabase.");
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

  if (args.verify) {
    console.log("\nVerify (read-only, independent of any apply bookkeeping):");
    const result = await verifyEditorialPlan({ client, plan, catalogSlugByRef });
    for (const check of result.checks) console.log(`  [${check.ok ? "OK" : "FAIL"}] ${check.message}`);
    console.log(`\n${result.summary.passed}/${result.summary.total} checks passed.`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (args.apply) {
    console.log("\nMode: APPLY — editorial observations + protected manual selections + catalog promotion");
  } else {
    console.log("\nMode: DRY-RUN — every read below is real, nothing will be written");
  }

  const report = await applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun: !args.apply });
  if (report.guardErrors.length > 0) {
    console.error("Plan REJECTED by guardEditorialPlan:");
    for (const e of report.guardErrors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  printApplyReport(report);
  if (!report.ok) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Fatal editorialCli error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
