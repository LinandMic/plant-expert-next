#!/usr/bin/env node
// Completion step for draft plant_catalog entries — LOCAL OUTPUT ONLY.
//
//   node scripts/plant-ingestion/src/completionCli.js --input <lot.json> [--estimate]
//   node scripts/plant-ingestion/src/completionCli.js --input <lot.json> --execute [--budget-usd 8] [--out <dir>]
//
// --estimate (default): prints the planned calls and cost range. No
//   network, no Supabase, no API key needed.
// --execute: the ONLY mode that spends money (Anthropic API: model calls +
//   web search). Reads plant_catalog READ-ONLY for a snapshot of current
//   values, then writes local files under --out
//   (default scripts/plant-ingestion/output/completion/<lot_id>/).
// It never writes to Supabase and has no --apply: the generated
// editorial-input.json / common-names.json go through the existing
// editorialCli.js / commonNamesCli.js dry-run -> review -> manual --apply.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateLot, estimateLot, runCompletion } from "./completion/runCompletion.js";
import { runWithPauseTurn } from "./completion/anthropicClient.js";
import { getAnthropicConfig } from "./completion/anthropicConfig.js";
import { loadSnapshot } from "./completion/snapshot.js";
import { DEFAULT_BUDGET_CAP_USD } from "./completion/completionConfig.js";
import {
  buildEditorialEntries,
  buildCommonNamesBatch,
  buildCatalogMap,
  buildPublishSql,
  buildReport,
  buildReportMarkdown,
} from "./completion/emit.js";
import { getSupabaseConfig } from "./apply/supabaseConfig.js";
import { createSupabaseAdminClient } from "./apply/supabaseAdminClient.js";
import { validateEditorialInput } from "./editorial/validateEditorialInput.js";
import { buildEditorialPlan } from "./editorial/buildEditorialPlan.js";
import { validateCommonNamesBatch } from "./editorial/validateCommonNamesBatch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INGESTION_ROOT = path.resolve(__dirname, "..");

export function parseArgs(argv) {
  const args = { input: null, execute: false, estimate: false, budgetUsd: DEFAULT_BUDGET_CAP_USD, out: null, snapshotFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--execute") args.execute = true;
    else if (a === "--estimate") args.estimate = true;
    else if (a === "--budget-usd") args.budgetUsd = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--snapshot") args.snapshotFile = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.execute && args.estimate) throw new Error("--execute and --estimate are mutually exclusive");
  if (!Number.isFinite(args.budgetUsd) || args.budgetUsd <= 0) throw new Error("--budget-usd must be a positive number");
  if (args.budgetUsd > DEFAULT_BUDGET_CAP_USD) throw new Error(`--budget-usd cannot exceed the hard cap of ${DEFAULT_BUDGET_CAP_USD} $`);
  return args;
}

function readJson(file) {
  const resolved = path.resolve(process.cwd(), file);
  if (!existsSync(resolved)) throw new Error(`file not found: ${file}`);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function printEstimate(e) {
  console.log("Mode: ESTIMATE — aucun appel réseau, aucune lecture Supabase, aucune dépense.");
  console.log(`  plantes                      : ${e.plants}`);
  console.log(`  appels API (proposition + sources) : ${e.api_calls}`);
  console.log(`  recherches web max           : ${e.max_web_searches} (0,01 $ chacune)`);
  console.log(`  pages lues max               : ${e.max_page_fetches} (≤ 12 000 tokens chacune)`);
  console.log(`  coût attendu                 : ${e.expected_usd.low.toFixed(2)} – ${e.expected_usd.high.toFixed(2)} $`);
  console.log(`  pire cas théorique           : ${e.worst_case_usd.toFixed(2)} $`);
  console.log(`  plafond dur                  : ${e.budget_cap_usd} $ (aucune plante n'est commencée si elle peut le dépasser)`);
  console.log(`  plantes garanties sous le plafond : ${e.plants_guaranteed_under_cap} / ${e.plants}`);
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (!args.input) throw new Error("usage: completionCli.js --input <lot.json> [--estimate | --execute] [--budget-usd N] [--out dir] [--snapshot file]");
  const lot = readJson(args.input);
  const lotErrors = validateLot(lot);
  if (lotErrors.length) throw new Error(`invalid lot: ${lotErrors.join("; ")}`);

  if (!args.execute) {
    printEstimate(estimateLot(lot, args.budgetUsd));
    console.log("\nPour lancer réellement (dépense) : relancer avec --execute.");
    return { mode: "estimate" };
  }

  console.log(`Mode: EXECUTE — appels payants (Anthropic) · plafond ${args.budgetUsd} $ · aucune écriture Supabase.`);
  const anthropic = (deps.getAnthropicConfig || getAnthropicConfig)();
  console.log(`  ANTHROPIC_API_KEY configurée : ${anthropic.hasApiKey}`);
  if (!anthropic.hasApiKey) throw new Error("ANTHROPIC_API_KEY missing (environment or scripts/plant-ingestion/.env.ingestion) — see .env.ingestion.example");

  let snapshot;
  if (args.snapshotFile) {
    snapshot = readJson(args.snapshotFile);
  } else {
    const supa = (deps.getSupabaseConfig || getSupabaseConfig)();
    console.log(`  Supabase (lecture seule) : hasUrl=${supa.hasUrl} hasServiceRoleKey=${supa.hasServiceRoleKey}`);
    if (!supa.hasUrl || !supa.hasServiceRoleKey) throw new Error("Supabase credentials missing for the read-only snapshot (or pass --snapshot <file>)");
    const client = (deps.createClient || createSupabaseAdminClient)(supa);
    snapshot = await loadSnapshot(client, lot.plants.map((p) => p.slug));
  }

  const callApi = deps.callApi || ((body) => runWithPauseTurn(body, { apiKey: anthropic.apiKey }));
  const generatedAt = (deps.now || (() => new Date()))().toISOString();
  const run = await runCompletion({ lot, snapshot, callApi, budgetCapUsd: args.budgetUsd, log: deps.log || console.log });

  const outDir = path.resolve(process.cwd(), args.out || path.join(INGESTION_ROOT, "output", "completion", lot.lot_id));
  mkdirSync(outDir, { recursive: true });

  const editorial = buildEditorialEntries(run.results, { generatedAt });
  const editorialErrors = editorial.flatMap((e) => validateEditorialInput(e).map((err) => `${e.catalog_ref}/${e.trait}: ${err.message}`));
  // Same plan builder editorialCli.js uses: throws on a duplicate (catalog_ref, trait).
  if (!editorialErrors.length && editorial.length) buildEditorialPlan(editorial);
  const commonNames = buildCommonNamesBatch(run.results, { generatedAt, lotId: lot.lot_id });
  const namesErrors = commonNames.rows.length ? validateCommonNamesBatch(commonNames).map((err) => err.message ?? err.code) : [];
  const report = buildReport(run.results, { lotId: lot.lot_id, generatedAt, spend: run.spend, budgetCapUsd: args.budgetUsd, stoppedForBudget: run.stoppedForBudget });
  report.output_validation = { editorial_errors: editorialErrors, common_names_errors: namesErrors };

  const files = {
    "editorial-input.json": JSON.stringify(editorial, null, 2),
    "common-names.json": JSON.stringify(commonNames, null, 2),
    "catalog-map.json": JSON.stringify(buildCatalogMap(lot.plants), null, 2),
    "report.json": JSON.stringify(report, null, 2),
    "report.md": buildReportMarkdown(report),
    "publish-candidates.sql": buildPublishSql(run.results, { lotId: lot.lot_id }),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(outDir, name), content);

  console.log(`\nDépense réelle : ${run.spend.usd.toFixed(2)} $ · publiables : ${report.summary.publishable}/${report.summary.plants}`);
  if (editorialErrors.length || namesErrors.length) console.log(`⚠️ validation des sorties : ${[...editorialErrors, ...namesErrors].join(" | ")}`);
  console.log(`Fichiers écrits dans ${path.relative(process.cwd(), outDir)}/ : ${Object.keys(files).join(", ")}`);
  return { mode: "execute", outDir, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`completionCli: ${error.message}`);
    process.exit(1);
  });
}
