#!/usr/bin/env node
// Layer B (compilation/validation) CLI. Reads the layer-A collection
// bundle and writes a transaction PLAN — never touches Supabase, never
// imports a Supabase client, never issues SQL (spec §2/§17). Layer C
// (real DB write) does not exist yet.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileTransactionPlan } from "./plan/compiler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "output");
const BUNDLE_PATH = path.join(OUTPUT_ROOT, "acer-mini-batch.json");
const PLAN_PATH = path.join(OUTPUT_ROOT, "acer-transaction-plan.json");

function fail(message) {
  console.error(`plant:ingestion:plan — ${message}`);
  process.exitCode = 1;
}

function run() {
  if (!existsSync(BUNDLE_PATH)) {
    fail(`source bundle not found at ${path.relative(process.cwd(), BUNDLE_PATH)}. Run "npm run plant:ingestion:dry-run" first.`);
    return;
  }

  let bundle;
  try {
    bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8"));
  } catch (err) {
    fail(`could not parse ${path.relative(process.cwd(), BUNDLE_PATH)} as JSON: ${err.message}`);
    return;
  }

  const result = compileTransactionPlan(bundle);

  if (!result.ok) {
    console.error(`plant:ingestion:plan — compilation FAILED with ${result.errors.length} error(s):`);
    for (const e of result.errors) {
      console.error(`  [${e.code}] ${e.message}`);
    }
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeFileSync(PLAN_PATH, JSON.stringify(result.plan, null, 2), "utf8");

  console.log(`plant:ingestion:plan — compiled OK. approval_required=true (no data written anywhere).`);
  console.log(`  taxa=${result.plan.summary.taxa} taxon_names=${result.plan.summary.taxon_names} catalog_entries=${result.plan.summary.catalog_entries}`);
  console.log(`  source_records=${result.plan.summary.source_records} trait_observations=${result.plan.summary.trait_observations} trait_selections=${result.plan.summary.trait_selections}`);
  console.log(`Output written to ${path.relative(process.cwd(), PLAN_PATH)}`);
}

run();
