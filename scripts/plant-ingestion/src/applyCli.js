#!/usr/bin/env node
// Layer C apply CLI. Defaults to a dry-run: it always reads the plan and
// reports exactly what it WOULD do, and only ever calls insert/update on
// Supabase when invoked with the explicit --apply flag. There is no other
// way to make this script write — "npm run plant:ingestion:apply" alone
// (bare, no flag) is dry-run only, by design (spec requirement: bare
// command must never write).
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see supabaseConfig.js)
// for BOTH dry-run and apply: even a dry-run needs a real client to perform
// its read-only lookups and produce an accurate report. If credentials are
// missing, this CLI stops cleanly with a clear message and a non-zero exit
// code — it never fabricates a report and never attempts an unauthenticated
// write.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";
import { applyPlan } from "./apply/applyPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PLAN_PATH = path.join(ROOT, "output", "acer-transaction-plan.json");

function parseArgs(argv) {
  const args = { apply: false, planPath: DEFAULT_PLAN_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--plan") {
      args.planPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function printReport(report) {
  console.log(`\nMode: ${report.dryRun ? "DRY-RUN (nothing written)" : "APPLY (writes performed)"}`);
  if (report.guardErrors.length > 0) {
    console.error(`Plan REJECTED by guardPlan — ${report.guardErrors.length} error(s):`);
    for (const e of report.guardErrors) console.error(`  - ${e}`);
    return;
  }
  for (const [table, step] of Object.entries(report.steps)) {
    if (step.status === "skipped") {
      console.log(`  ${table}: SKIPPED (reason=${step.reason})`);
      continue;
    }
    console.log(`  ${table}: created=${step.created} updated=${step.updated ?? 0} unchanged=${step.unchanged} errors=${step.errors.length}`);
    for (const e of step.errors) console.error(`    ! ${e}`);
    for (const p of step.protectedFields ?? []) {
      console.log(`    protected: ${p.catalog_ref}/${p.trait} — provider proposed ${JSON.stringify(p.provider_value)}, kept curator value ${JSON.stringify(p.current_value)} (manual_resolution)`);
    }
  }
  console.log(`  TOTAL: created=${report.totals.created} updated=${report.totals.updated} unchanged=${report.totals.unchanged} errors=${report.totals.errors} skipped=${report.totals.skipped} protected=${report.totals.protectedFields.length}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.planPath)) {
    console.error(`plant:ingestion:apply — plan not found at ${path.relative(process.cwd(), args.planPath)}. Run "npm run plant:ingestion:plan" first.`);
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(args.planPath, "utf8"));
  } catch (err) {
    console.error(`plant:ingestion:apply — could not parse plan JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const config = getSupabaseConfig();
  console.log(`Plant Ingestion Apply — ${new Date().toISOString()}`);
  console.log(`SUPABASE_URL: ${config.hasUrl ? "present" : "MISSING"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${config.hasServiceRoleKey ? "present" : "MISSING"}`);

  if (!config.hasUrl || !config.hasServiceRoleKey) {
    console.error("\nplant:ingestion:apply — STOPPING: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required (server/local-only, never NEXT_PUBLIC_). No client was created, nothing was read or written.");
    process.exitCode = 1;
    return;
  }

  const client = createSupabaseAdminClient({ url: config.url, serviceRoleKey: config.serviceRoleKey });

  if (args.apply) {
    console.log("\n--apply flag present: this run WILL write to Supabase if the plan is valid.");
  } else {
    console.log("\nNo --apply flag: DRY-RUN only. Pass --apply to actually write.");
  }

  const report = await applyPlan({ client, plan, dryRun: !args.apply });
  printReport(report);

  if (!report.ok) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Fatal apply error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
