#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";
import { queryWcvp } from "./providers/wcvp.js";
import { queryPerenual } from "./providers/perenual.js";
import { queryTrefle } from "./providers/trefle.js";
import { classifyMatch } from "./taxonomyMatch.js";
import { writeCoverageCsv } from "./coverage.js";
import { writeContradictionsCsv } from "./contradictionsCsv.js";
import { writeTaxonomyCsv } from "./taxonomyCsv.js";
import { writeReportMd } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_ROOT = path.join(ROOT, "raw");
const OUTPUT_ROOT = path.join(ROOT, "output");

// Trait observations are only trusted (merged into the plant's `traits`
// map) when the provider's own candidate selection was confident enough
// that the record genuinely describes the queried taxon/cultivar. A
// `parent_only` result still carries real data — about the PARENT, not the
// cultivar that was asked for — so its traits are kept but the plant is
// marked `traits_scope: "parent_only"` rather than silently presented as
// cultivar-specific data (spec §13/§22). `ambiguous`/`not_found`/
// `provider_error`/`skipped_no_key` never contribute trait observations —
// there is no record confident enough to attach them to.
const TRAIT_ELIGIBLE_REASONS = new Set(["exact_scientific_match", "exact_cultivar_match", "parent_taxon_match", "parent_only"]);

function loadPlants() {
  const raw = readFileSync(path.join(ROOT, "plants.json"), "utf8");
  return JSON.parse(raw);
}

function mergeTraits(target, sourceTraits) {
  for (const [traitName, entry] of Object.entries(sourceTraits || {})) {
    target[traitName] = target[traitName] || { trait: traitName, observations: [] };
    target[traitName].observations.push(...entry.observations);
  }
}

async function processPlant(plant, config) {
  const inputName = plant.input_name;

  const wcvpResult = await queryWcvp({ inputName, rawRoot: RAW_ROOT });
  const perenualResult = await queryPerenual({ inputName, rawRoot: RAW_ROOT, apiKey: config.perenualApiKey });
  const trefleResult = await queryTrefle({ inputName, rawRoot: RAW_ROOT, apiKey: config.trefleApiKey });

  const plantErrors = [wcvpResult.error, perenualResult.error, trefleResult.error].filter(Boolean);

  const wcvpTaxonomy = wcvpResult.taxonomy;

  const perenualMatch = perenualResult.record
    ? classifyMatch({ providerName: perenualResult.record.scientific_name, wcvpTaxonomy, cultivarParentName: wcvpResult.taxonomic_parent })
    : "not_found";

  const trefleMatch = trefleResult.record
    ? classifyMatch({ providerName: trefleResult.record.scientific_name, wcvpTaxonomy, cultivarParentName: wcvpResult.taxonomic_parent })
    : "not_found";

  const traits = {};
  let traitsScope = "full";
  if (TRAIT_ELIGIBLE_REASONS.has(perenualResult.selection_reason)) mergeTraits(traits, perenualResult.traits);
  if (TRAIT_ELIGIBLE_REASONS.has(trefleResult.selection_reason)) mergeTraits(traits, trefleResult.traits);
  if (perenualResult.selection_reason === "parent_only" || trefleResult.selection_reason === "parent_only") {
    traitsScope = "parent_only";
  }

  const normalizedEntry = {
    input_name: inputName,
    input_type: plant.type,
    taxonomy: wcvpTaxonomy || {
      accepted_name: null, accepted_taxon_id: null, taxonomic_rank: null, family: null, genus: null,
      taxonomic_status: null, canonical_name: null, synonyms: [], source_taxon_id: null,
    },
    horticultural_identity: {
      cultivar: wcvpResult.cultivar_name,
      variety: (perenualResult.record && perenualResult.record.variety_field) || null,
      hybrid: (perenualResult.record && perenualResult.record.hybrid_field) || null,
    },
    traits_scope: traitsScope,
    providers: {
      wcvp: {
        taxonomic_parent: wcvpResult.taxonomic_parent,
        not_found: Boolean(wcvpResult.not_found),
        selection_reason: wcvpResult.selection_reason,
        queried_usage: wcvpResult.queried_usage,
        accepted_usage: wcvpResult.accepted_usage,
        candidates: wcvpResult.candidates,
        error: wcvpResult.error,
      },
      perenual: {
        status: perenualResult.status,
        selection_reason: perenualResult.selection_reason,
        candidate_count: perenualResult.candidate_count ?? null,
        candidates: perenualResult.candidates || [],
        record: perenualResult.record,
        wcvp_match_type: perenualMatch,
        error: perenualResult.error,
      },
      trefle: {
        status: trefleResult.status,
        selection_reason: trefleResult.selection_reason,
        candidate_count: trefleResult.candidate_count ?? null,
        candidates: trefleResult.candidates || [],
        record: trefleResult.record,
        provenance: trefleResult.provenance || null,
        wcvp_match_type: trefleMatch,
        error: trefleResult.error,
      },
    },
    traits,
  };

  return { normalizedEntry, plantErrors };
}

async function run() {
  const config = getConfig();
  console.log(`Plant Benchmark — ${new Date().toISOString()}`);
  console.log(`Perenual key: ${config.hasPerenualKey ? "present" : "MISSING (perenual skipped for every plant)"}`);
  console.log(`Trefle key:   ${config.hasTrefleKey ? "present" : "MISSING (trefle skipped for every plant)"}`);

  mkdirSync(RAW_ROOT, { recursive: true });
  mkdirSync(OUTPUT_ROOT, { recursive: true });

  const plants = loadPlants();
  const normalized = [];
  const errors = [];

  for (const plant of plants) {
    console.log(`\n--- ${plant.input_name} (${plant.type}) ---`);
    try {
      const { normalizedEntry, plantErrors } = await processPlant(plant, config);
      normalized.push(normalizedEntry);
      errors.push(...plantErrors);
    } catch (err) {
      // A single plant must never abort the whole benchmark (spec §17).
      console.error(`Unexpected failure processing "${plant.input_name}":`, err && err.message ? err.message : err);
      errors.push({
        provider: "orchestrator",
        status: "error",
        http_status: null,
        message: err && err.message ? err.message : String(err),
        retrieved_at: new Date().toISOString(),
        input_name: plant.input_name,
      });
      normalized.push({
        input_name: plant.input_name,
        input_type: plant.type,
        taxonomy: { accepted_name: null, accepted_taxon_id: null, taxonomic_rank: null, family: null, genus: null, taxonomic_status: null, canonical_name: null, synonyms: [], source_taxon_id: null },
        horticultural_identity: { cultivar: null, variety: null, hybrid: null },
        traits_scope: "full",
        providers: {
          wcvp: { taxonomic_parent: null, not_found: false, selection_reason: "provider_error", queried_usage: null, accepted_usage: null, candidates: [], error: { provider: "orchestrator", message: "unexpected_failure" } },
          perenual: { status: "provider_error", selection_reason: "provider_error", candidate_count: null, candidates: [], record: null, wcvp_match_type: "not_found", error: { provider: "orchestrator", message: "unexpected_failure" } },
          trefle: { status: "provider_error", selection_reason: "provider_error", candidate_count: null, candidates: [], record: null, provenance: null, wcvp_match_type: "not_found", error: { provider: "orchestrator", message: "unexpected_failure" } },
        },
        traits: {},
      });
    }
  }

  writeFileSync(path.join(OUTPUT_ROOT, "normalized.json"), JSON.stringify(normalized, null, 2), "utf8");
  writeFileSync(path.join(OUTPUT_ROOT, "errors.json"), JSON.stringify(errors, null, 2), "utf8");

  writeCoverageCsv(normalized, path.join(OUTPUT_ROOT, "coverage.csv"));
  writeContradictionsCsv(normalized, path.join(OUTPUT_ROOT, "contradictions.csv"));
  writeTaxonomyCsv(normalized, path.join(OUTPUT_ROOT, "taxonomy.csv"));
  writeReportMd(normalized, errors, config, path.join(OUTPUT_ROOT, "report.md"));

  console.log(`\nDone. ${normalized.length} plants processed, ${errors.length} provider-level error(s) recorded.`);
  console.log(`Output written to ${path.relative(process.cwd(), OUTPUT_ROOT)}/`);
}

run().catch((err) => {
  console.error("Fatal benchmark error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
