#!/usr/bin/env node
// Dry-run CLI entry point. Writes ONLY a local JSON bundle — never touches
// Supabase, never imports a Supabase client, never issues SQL (spec §4).

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";
import { buildAcerMiniBatch } from "./bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "output");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");

function loadPlants() {
  const raw = readFileSync(path.join(ROOT, "plants.json"), "utf8");
  const plants = JSON.parse(raw);
  if (plants.length !== 2) {
    throw new Error(`plants.json must contain exactly 2 entries for this dry-run tool, found ${plants.length}`);
  }
  const [speciesInput, cultivarInput] = plants;
  if (speciesInput.type !== "species" || cultivarInput.type !== "cultivar") {
    throw new Error('plants.json must be exactly [{ type: "species" }, { type: "cultivar" }] in that order');
  }
  return { speciesInput, cultivarInput };
}

async function run() {
  const config = getConfig();
  // Never logs key values — only presence, same contract as the benchmark.
  console.log(`Plant Ingestion Dry-Run — ${new Date().toISOString()}`);
  console.log(`Mode: dry_run (no Supabase client imported, no SQL, no network write of any kind)`);
  console.log(`Perenual key: ${config.hasPerenualKey ? "present" : "MISSING (perenual skipped)"}`);
  console.log(`Trefle key:   ${config.hasTrefleKey ? "present" : "MISSING (trefle skipped)"}`);

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  mkdirSync(RAW_ROOT, { recursive: true });

  const { speciesInput, cultivarInput } = loadPlants();

  const bundle = await buildAcerMiniBatch({ speciesInput, cultivarInput, config, rawRoot: RAW_ROOT });

  const outPath = path.join(OUTPUT_ROOT, "acer-mini-batch.json");
  writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");

  console.log(`\nDone. ${bundle.plants.length} plant(s) processed.`);
  for (const p of bundle.plants) {
    console.log(`  - ${p.input.name}: blocked=${p.blocked}, catalog=${p.catalog ? p.catalog.catalog_ref : "null"}, warnings=${p.warnings.length}`);
  }
  console.log(`Output written to ${path.relative(process.cwd(), outPath)}`);
}

run().catch((err) => {
  console.error("Fatal dry-run error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
