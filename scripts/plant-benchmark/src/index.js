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

function loadPlants() {
  const raw = readFileSync(path.join(ROOT, "plants.json"), "utf8");
  return JSON.parse(raw);
}

async function processPlant(plant, config) {
  const inputName = plant.input_name;

  const wcvpResult = await queryWcvp({ inputName, rawRoot: RAW_ROOT });
  const perenualResult = await queryPerenual({ inputName, rawRoot: RAW_ROOT, apiKey: config.perenualApiKey });
  const trefleResult = await queryTrefle({ inputName, rawRoot: RAW_ROOT, apiKey: config.trefleApiKey });

  const plantErrors = [wcvpResult.error, perenualResult.error, trefleResult.error].filter(Boolean);

  const wcvpTaxonomy = wcvpResult.taxonomy;
  const isCultivarInput = Boolean(wcvpResult.cultivar_name);

  const perenualMatch = perenualResult.record
    ? classifyMatch({
        providerName: perenualResult.record.scientific_name,
        wcvpRecord: wcvpTaxonomy,
        isCultivarInput,
        cultivarParentName: wcvpResult.taxonomic_parent,
      })
    : "not_found";

  const trefleMatch = trefleResult.record
    ? classifyMatch({
        providerName: trefleResult.record.scientific_name,
        wcvpRecord: wcvpTaxonomy,
        isCultivarInput,
        cultivarParentName: wcvpResult.taxonomic_parent,
      })
    : "not_found";

  // Trait observations from both horticultural providers are merged into
  // one map keyed by trait name — never collapsed into a single value
  // (spec §8). Each provider's own observations keep their own
  // provenance/uncertainty markers untouched.
  const traits = {};
  for (const [traitName, entry] of Object.entries(perenualResult.traits || {})) {
    traits[traitName] = traits[traitName] || { trait: traitName, observations: [] };
    traits[traitName].observations.push(...entry.observations);
  }
  for (const [traitName, entry] of Object.entries(trefleResult.traits || {})) {
    traits[traitName] = traits[traitName] || { trait: traitName, observations: [] };
    traits[traitName].observations.push(...entry.observations);
  }

  const normalizedEntry = {
    input_name: inputName,
    input_type: plant.type,
    taxonomy: {
      accepted_name: wcvpTaxonomy ? wcvpTaxonomy.accepted_name : null,
      accepted_taxon_id: wcvpTaxonomy ? wcvpTaxonomy.accepted_taxon_id : null,
      rank: wcvpTaxonomy ? wcvpTaxonomy.taxonomic_rank : null,
      family: wcvpTaxonomy ? wcvpTaxonomy.family : null,
      genus: wcvpTaxonomy ? wcvpTaxonomy.genus : null,
      taxonomic_status: wcvpTaxonomy ? wcvpTaxonomy.taxonomic_status : null,
      canonical_name: wcvpTaxonomy ? wcvpTaxonomy.canonical_name : null,
      synonyms: wcvpTaxonomy ? wcvpTaxonomy.synonyms : [],
      source_taxon_id: wcvpTaxonomy ? wcvpTaxonomy.source_taxon_id : null,
    },
    horticultural_identity: {
      cultivar: wcvpResult.cultivar_name,
      variety: null,
      hybrid: (perenualResult.record && perenualResult.record.hybrid_field) || null,
    },
    providers: {
      wcvp: {
        taxonomic_parent: wcvpResult.taxonomic_parent,
        not_found: Boolean(wcvpResult.not_found),
        error: wcvpResult.error,
      },
      perenual: {
        status: perenualResult.status,
        candidate_count: perenualResult.candidate_count ?? null,
        record: perenualResult.record,
        match_type: perenualMatch,
        error: perenualResult.error,
      },
      trefle: {
        status: trefleResult.status,
        candidate_count: trefleResult.candidate_count ?? null,
        record: trefleResult.record,
        provenance: trefleResult.provenance || null,
        match_type: trefleMatch,
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
        taxonomy: { accepted_name: null, accepted_taxon_id: null, rank: null, family: null, genus: null, taxonomic_status: null, canonical_name: null, synonyms: [], source_taxon_id: null },
        horticultural_identity: { cultivar: null, variety: null, hybrid: null },
        providers: {
          wcvp: { taxonomic_parent: null, not_found: false, error: { provider: "orchestrator", message: "unexpected_failure" } },
          perenual: { status: "error", candidate_count: null, record: null, match_type: "not_found", error: { provider: "orchestrator", message: "unexpected_failure" } },
          trefle: { status: "error", candidate_count: null, record: null, provenance: null, match_type: "not_found", error: { provider: "orchestrator", message: "unexpected_failure" } },
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
