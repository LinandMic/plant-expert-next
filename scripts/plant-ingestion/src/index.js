#!/usr/bin/env node
// Dry-run CLI entry point. Writes ONLY a local JSON bundle — never touches
// Supabase, never imports a Supabase client, never issues SQL (spec §4).
//
// Accepts any batch size via --plants/--out (defaults to the exact
// original Acer/Bloodgood pair and its exact original output path, so
// `npm run plant:ingestion:dry-run` with no arguments is byte-for-byte
// unchanged from before batch support existed).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";
import { buildPlantBatch } from "./bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "output");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");
const DEFAULT_PLANTS_PATH = path.join(ROOT, "plants.json");
const DEFAULT_BUNDLE_PATH = path.join(OUTPUT_ROOT, "acer-mini-batch.json");

function parseArgs(argv) {
  const args = { plantsPath: DEFAULT_PLANTS_PATH, outPath: DEFAULT_BUNDLE_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--plants") {
      args.plantsPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--out") {
      args.outPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

// loadPlants(plantsPath) -> [{ input_name, type }, ...]
// Any batch size, one or more entries. Real structural validation
// (duplicate names, a cultivar with no matching species sibling in the
// same file, a type that doesn't match the name) happens in
// planBatchGrouping (called by buildPlantBatch) — this loader only
// confirms the file itself is a non-empty JSON array, so a malformed file
// fails with a clear message before any network call is attempted.
function loadPlants(plantsPath) {
  if (!existsSync(plantsPath)) {
    throw new Error(`plants file not found at ${path.relative(process.cwd(), plantsPath)}`);
  }
  const raw = readFileSync(plantsPath, "utf8");
  const plants = JSON.parse(raw);
  if (!Array.isArray(plants) || plants.length === 0) {
    throw new Error(`${path.relative(process.cwd(), plantsPath)} must be a non-empty JSON array of { input_name, type }`);
  }
  return plants;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig();
  // Never logs key values — only presence, same contract as the benchmark.
  console.log(`Plant Ingestion Dry-Run — ${new Date().toISOString()}`);
  console.log(`Mode: dry_run (no Supabase client imported, no SQL, no network write of any kind)`);
  console.log(`Perenual key: ${config.hasPerenualKey ? "present" : "MISSING (perenual skipped)"}`);
  console.log(`Trefle key:   ${config.hasTrefleKey ? "present" : "MISSING (trefle skipped)"}`);
  console.log(`Plants file:  ${path.relative(process.cwd(), args.plantsPath)}`);

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  mkdirSync(RAW_ROOT, { recursive: true });

  const plants = loadPlants(args.plantsPath);
  const bundle = await buildPlantBatch({ plants, config, rawRoot: RAW_ROOT });

  mkdirSync(path.dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, JSON.stringify(bundle, null, 2), "utf8");

  console.log(`\nDone. ${bundle.plants.length} plant(s) processed.`);
  for (const p of bundle.plants) {
    console.log(`  - ${p.input.name}: blocked=${p.blocked}, catalog=${p.catalog ? p.catalog.catalog_ref : "null"}, warnings=${p.warnings.length}`);
  }
  console.log(`Output written to ${path.relative(process.cwd(), args.outPath)}`);
}

run().catch((err) => {
  console.error("Fatal dry-run error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
