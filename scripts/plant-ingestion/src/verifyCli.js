#!/usr/bin/env node
// Standalone Layer C verification CLI — read-only. Can be run any time
// after an apply (or independently) to confirm the plan's rows really exist
// in the DB, exactly once, FK-coherent. Requires service_role credentials:
// plant_source_records/plant_trait_observations/plant_trait_selections have
// RLS enabled with no anon/authenticated policy, so only service_role can
// even read them back for verification.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";
import { verifyPlan } from "./apply/verifyPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PLAN_PATH = path.join(ROOT, "output", "acer-transaction-plan.json");

function parseArgs(argv) {
  const args = { planPath: DEFAULT_PLAN_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--plan") {
      args.planPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.planPath)) {
    console.error(`plant:ingestion:verify — plan not found at ${path.relative(process.cwd(), args.planPath)}. Run "npm run plant:ingestion:plan" first.`);
    process.exitCode = 1;
    return;
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(args.planPath, "utf8"));
  } catch (err) {
    console.error(`plant:ingestion:verify — could not parse plan JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const config = getSupabaseConfig();
  console.log(`Plant Ingestion Verify — ${new Date().toISOString()}`);
  console.log(`SUPABASE_URL: ${config.hasUrl ? "present" : "MISSING"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${config.hasServiceRoleKey ? "present" : "MISSING"}`);

  if (!config.hasUrl || !config.hasServiceRoleKey) {
    console.error("\nplant:ingestion:verify — STOPPING: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required. No client was created, nothing was read.");
    process.exitCode = 1;
    return;
  }

  const client = createSupabaseAdminClient({ url: config.url, serviceRoleKey: config.serviceRoleKey });
  const result = await verifyPlan({ client, plan });

  console.log(`\n${result.ok ? "PASS" : "FAIL"} — ${result.summary?.passed ?? 0}/${result.summary?.total ?? 0} checks passed`);
  for (const check of result.checks) {
    if (!check.ok) console.error(`  ! ${check.message}`);
  }

  if (!result.ok) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Fatal verify error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
