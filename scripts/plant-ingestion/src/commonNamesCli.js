#!/usr/bin/env node
// Common-names batch CLI — same shape as editorialCli.js, for
// plant_common_names instead of plant_trait_observations/selections.
//
// Usage:
//   node scripts/plant-ingestion/src/commonNamesCli.js \
//     --input <common-names-batch.json> \
//     [--apply] [--verify]
//
// Without --apply: DRY-RUN. Every read --apply would perform still runs
// (an accurate preview: taxon resolution + existing-row lookup), nothing
// is ever written.
// With --apply: writes plant_common_names rows — see
// editorial/applyCommonNamesBatch.js for the exact per-row logic
// (idempotent: re-running the same batch against a DB it already fully
// applied reports everything "unchanged").
// With --verify: read-only cross-check against the live DB, independent of
// --apply's own bookkeeping — see verifyCommonNamesBatch(). Mutually
// exclusive with --apply.
//
// No --catalog-map is needed here (unlike editorialCli.js): each row
// resolves its own taxon via canonical_name, directly against plant_taxa —
// there is no symbolic catalog_ref indirection for common names.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { validateCommonNamesBatch, summarizeCoverage } from "./editorial/validateCommonNamesBatch.js";
import { applyCommonNamesBatch, verifyCommonNamesBatch } from "./editorial/applyCommonNamesBatch.js";
import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";

function parseArgs(argv) {
  const args = { inputPath: null, apply: false, verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") {
      args.inputPath = argv[i + 1];
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

function printApplyReport(report) {
  console.log(`\n${report.dryRun ? "DRY-RUN report (nothing written)" : "APPLY report (writes performed)"}:\n`);
  if (report.resolveErrors.length > 0) {
    console.log("Taxon resolution errors:");
    for (const e of report.resolveErrors) console.log(`  ! ${e}`);
    console.log("");
  }
  for (const entry of report.entries) {
    const errSuffix = entry.errors.length ? ` — ${entry.errors.join("; ")}` : "";
    console.log(`${entry.taxon_ref}/${entry.locale} "${entry.name}": ${entry.status}${errSuffix}`);
  }
  const t = report.totals;
  console.log(`\nTOTAL: created=${t.created} updated=${t.updated} unchanged=${t.unchanged} failed=${t.failed}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.inputPath) {
    console.error("commonNamesCli — usage: node commonNamesCli.js --input <common-names-batch.json> [--apply] [--verify]");
    process.exitCode = 1;
    return;
  }
  if (args.apply && args.verify) {
    console.error("commonNamesCli — --apply and --verify are mutually exclusive.");
    process.exitCode = 1;
    return;
  }

  let batch;
  try {
    batch = readJson(args.inputPath, "input");
  } catch (err) {
    console.error(`commonNamesCli — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Common Names Batch CLI — ${args.apply ? "APPLY" : args.verify ? "VERIFY (read-only)" : "DRY-RUN / VALIDATION ONLY"} — ${new Date().toISOString()}`);

  const validationErrors = validateCommonNamesBatch(batch);
  if (validationErrors.length > 0) {
    console.error(`\n${batch.rows?.length ?? "?"} row(s) read from ${args.inputPath} — REJECTED:`);
    for (const e of validationErrors) console.error(`  ! [${e.code}] ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const requiredTaxonRefs = [...new Set((batch.rows || []).map((r) => r.taxon_ref))];
  const coverage = summarizeCoverage(batch, requiredTaxonRefs);
  console.log(`\nBatch valid — ${batch.rows.length} row(s), ${requiredTaxonRefs.length} distinct taxa.`);
  console.log(`  fr preferred: ${requiredTaxonRefs.length - coverage.missingFrPreferred.length}/${requiredTaxonRefs.length}${coverage.missingFrPreferred.length ? ` (missing: ${coverage.missingFrPreferred.join(", ")})` : ""}`);
  console.log(`  en preferred: ${requiredTaxonRefs.length - coverage.missingEnPreferred.length}/${requiredTaxonRefs.length}${coverage.missingEnPreferred.length ? ` (missing: ${coverage.missingEnPreferred.join(", ")})` : ""}`);

  const config = getSupabaseConfig();
  console.log(`\nSUPABASE_URL: ${config.hasUrl ? "present" : "MISSING"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${config.hasServiceRoleKey ? "present" : "MISSING"}`);
  if (!config.hasUrl || !config.hasServiceRoleKey) {
    console.log("\nNo Supabase credentials — local batch validation only, nothing was checked against Supabase.");
    return;
  }
  const client = createSupabaseAdminClient({ url: config.url, serviceRoleKey: config.serviceRoleKey });

  if (args.verify) {
    console.log("\nVerify (read-only, independent of any apply bookkeeping):");
    const result = await verifyCommonNamesBatch({ client, batch });
    for (const check of result.checks) console.log(`  [${check.ok ? "OK" : "FAIL"}] ${check.message}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.log(args.apply ? "\nMode: APPLY — plant_common_names rows will be written" : "\nMode: DRY-RUN — every read below is real, nothing will be written");

  const report = await applyCommonNamesBatch({ client, batch, dryRun: !args.apply });
  printApplyReport(report);
  if (!report.ok) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Fatal commonNamesCli error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
