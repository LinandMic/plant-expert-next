#!/usr/bin/env node
// Layer B sub-plan extraction CLI. Reads an existing transaction plan and
// writes a NEW plan containing only the requested catalog_ref(s) and their
// structural dependencies — never touches Supabase, never imports a
// Supabase client, never issues SQL. Pure JSON in, JSON out; never hand-
// edit a plan file to narrow it down.
//
// Usage:
//   node scripts/plant-ingestion/src/filterPlanCli.js \
//     --plan <input.json> \
//     --catalog-ref <ref> [--catalog-ref <ref> ...] \
//     --out <output.json>

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { filterPlanByCatalogRefs } from "./filterPlan.js";

function parseArgs(argv) {
  const args = { planPath: null, catalogRefs: [], outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--plan") {
      args.planPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--catalog-ref") {
      args.catalogRefs.push(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--out") {
      args.outPath = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`plant:ingestion:filter-plan — ${message}`);
  process.exitCode = 1;
}

function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.planPath || args.catalogRefs.length === 0 || !args.outPath) {
    fail('usage: node filterPlanCli.js --plan <input.json> --catalog-ref <ref> [--catalog-ref <ref> ...] --out <output.json>');
    return;
  }

  const planPath = path.resolve(process.cwd(), args.planPath);
  const outPath = path.resolve(process.cwd(), args.outPath);

  if (!existsSync(planPath)) {
    fail(`plan not found at ${path.relative(process.cwd(), planPath)}`);
    return;
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (err) {
    fail(`could not parse ${path.relative(process.cwd(), planPath)} as JSON: ${err.message}`);
    return;
  }

  let filtered;
  try {
    filtered = filterPlanByCatalogRefs(plan, args.catalogRefs);
  } catch (err) {
    fail(err.message);
    return;
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(filtered, null, 2), "utf8");

  console.log(`plant:ingestion:filter-plan — sub-plan written for ${args.catalogRefs.length} catalog_ref(s): ${args.catalogRefs.join(", ")}`);
  console.log(`  taxa=${filtered.summary.taxa} taxon_names=${filtered.summary.taxon_names} catalog_entries=${filtered.summary.catalog_entries}`);
  console.log(`  source_records=${filtered.summary.source_records} trait_observations=${filtered.summary.trait_observations} trait_selections=${filtered.summary.trait_selections}`);
  console.log(`Output written to ${path.relative(process.cwd(), outPath)}`);
}

run();
