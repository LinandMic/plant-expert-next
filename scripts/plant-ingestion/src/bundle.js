// Orchestration only — network calls are the REUSED, unmodified benchmark
// provider functions (spec §2: "ne duplique pas les clients API"). All
// botanical interpretation (crosswalks, taxon-sharing, selection proposals)
// lives in the pure modules imported below, which is what is unit tested.

import { queryWcvp } from "../../plant-benchmark/src/providers/wcvp.js";
import { queryPerenual } from "../../plant-benchmark/src/providers/perenual.js";
import { queryTrefle } from "../../plant-benchmark/src/providers/trefle.js";
import { parseCultivarName } from "../../plant-benchmark/src/taxonomyMatch.js";
import { fetchJson } from "../../plant-benchmark/src/httpClient.js";
import { createCachedFetch } from "../../plant-benchmark/src/providerCache.js";

import { planBatchGrouping } from "./batchGrouping.js";
import { buildTaxonDryRun, buildTaxonNames } from "./taxonomy.js";
import { buildSpeciesCatalogEntry, buildCultivarCatalogEntry } from "./catalog.js";
import { buildSourceRecord, buildObservations } from "./provenance.js";
import { applyDeterministicNormalizations } from "./normalization.js";
import { proposeSelections } from "./selections.js";
import { checkAcerSpeciesDrift, checkBloodgoodDrift } from "./drift.js";

// resolveSharedTaxon(parentName, { rawRoot }) — the ONE WCVP call for a
// species+cultivar pair. Called once for the species input; its result is
// reused for the cultivar too, so the two catalog entries are structurally
// guaranteed to share the same taxon_ref (spec §6) rather than merely
// hoping two separate network calls agree.
async function resolveSharedTaxon(parentName, { rawRoot, fetchImpl }) {
  const wcvpResult = await queryWcvp({ inputName: parentName, rawRoot, fetchImpl });
  const wcvpTaxonomy = wcvpResult.taxonomy;
  const built = buildTaxonDryRun(wcvpTaxonomy);
  const names = built.blocked ? [] : buildTaxonNames(wcvpTaxonomy, built.taxon_ref);
  return { wcvpResult, wcvpTaxonomy, ...built, names };
}

// composeTaxonomyField(sharedTaxon) — pure. Builds the bundle's `taxonomy`
// object, explicitly including `names` (the plant_taxon_names dry-run rows
// — accepted name + real WCVP synonyms only, spec §4/§7) alongside the
// plant_taxa fields. Exported so the composition itself is unit-testable
// without a network call.
export function composeTaxonomyField(sharedTaxon) {
  if (sharedTaxon.blocked) return null;
  return { ...sharedTaxon.taxon, names: sharedTaxon.names };
}

// applyTaxonomyAmbiguity(sourceRecord, observations, warnings) -> observations
// If this source record's taxonomy_match_type=ambiguous is applicable,
// always records why (warnings.push). If it is NOT structurally resolved,
// every observation from this source is marked uncertain=true (never
// eligible for an automatic selection — see selections.js's `eligible`).
// taxonomy_match_type itself is never touched.
function applyTaxonomyAmbiguity(sourceRecord, observations, warnings) {
  const assessment = sourceRecord.taxonomy_ambiguity;
  if (!assessment.applicable) return observations;

  warnings.push(`${sourceRecord.source_record.provider}: ${assessment.explanation}`);
  if (assessment.resolved) return observations;

  return observations.map((o) => ({ ...o, uncertain: true }));
}

async function fetchHorticultural(inputName, { rawRoot, config, fetchImpl }) {
  const retrievedAt = new Date().toISOString();
  const [perenualResult, trefleResult] = await Promise.all([
    queryPerenual({ inputName, rawRoot, apiKey: config.perenualApiKey, accessTier: config.perenualAccessTier, fetchImpl }),
    queryTrefle({ inputName, rawRoot, apiKey: config.trefleApiKey, fetchImpl }),
  ]);
  return { perenualResult, trefleResult, retrievedAt };
}

// buildPlantEntry — builds one `plants[]` entry of the dry-run bundle for
// either the species or the cultivar, given the ALREADY-RESOLVED shared
// taxon (from resolveSharedTaxon, called once by buildAcerMiniBatch below).
async function buildPlantEntry({ inputName, inputType, sharedTaxon, catalogRefValue, parentCatalogRef, config, rawRoot, fetchImpl }) {
  const warnings = [...sharedTaxon.warnings];
  const { cultivarName } = parseCultivarName(inputName);

  const { perenualResult, trefleResult, retrievedAt } = await fetchHorticultural(inputName, { rawRoot, config, fetchImpl });

  let catalog = null;
  if (!sharedTaxon.blocked) {
    catalog = cultivarName
      ? buildCultivarCatalogEntry({
          catalogRef: catalogRefValue,
          wcvpTaxonRef: sharedTaxon.taxon_ref,
          canonicalName: sharedTaxon.wcvpTaxonomy.canonical_name,
          cultivarName,
          parentCatalogRef,
        })
      : buildSpeciesCatalogEntry({
          catalogRef: catalogRefValue,
          wcvpTaxonRef: sharedTaxon.taxon_ref,
          canonicalName: sharedTaxon.wcvpTaxonomy.canonical_name,
        });
  }

  const sourceRecords = [];

  const wcvpSr = buildSourceRecord({ provider: "wcvp", catalogRef: catalogRefValue, result: sharedTaxon.wcvpResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt });
  sourceRecords.push(wcvpSr.source_record);

  const perenualSr = buildSourceRecord({ provider: "perenual", catalogRef: catalogRefValue, result: perenualResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt, cultivarName });
  sourceRecords.push(perenualSr.source_record);
  const perenualObservations = buildObservations({ provider: "perenual", catalogRef: catalogRefValue, sourceRecordRef: perenualSr.source_record_ref, result: perenualResult });

  const trefleSr = buildSourceRecord({ provider: "trefle", catalogRef: catalogRefValue, result: trefleResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt, cultivarName });
  sourceRecords.push(trefleSr.source_record);
  const trefleObservations = buildObservations({ provider: "trefle", catalogRef: catalogRefValue, sourceRecordRef: trefleSr.source_record_ref, result: trefleResult });

  // taxonomy_match_type=ambiguous cross-check: see taxonomyAmbiguity.js for
  // the exact, non-intuitive reasoning. taxonomy_match_type ITSELF is never
  // rewritten (it stays exactly what classifyMatch computed) — only the
  // downstream uncertain-flagging/selection-blocking decision depends on
  // whether the ambiguity is structurally explained.
  const ambiguityAdjustedObservations = [
    ...applyTaxonomyAmbiguity(perenualSr, perenualObservations, warnings),
    ...applyTaxonomyAmbiguity(trefleSr, trefleObservations, warnings),
  ];

  const { observations, warnings: normalizationWarnings } = applyDeterministicNormalizations(ambiguityAdjustedObservations);
  warnings.push(...normalizationWarnings);

  let selections = [];
  if (catalog) {
    const proposed = proposeSelections({ observations, family: sharedTaxon.wcvpTaxonomy ? sharedTaxon.wcvpTaxonomy.family : null });
    selections = proposed.selections;
    warnings.push(...proposed.warnings);
  }

  // Drift-vs-baseline is a read-only comparison against a previously
  // validated live run — never a data source. It is narrowly gated on the
  // EXACT input name so it can never silently apply to a different plant
  // (spec §2). Warnings only; source_records/observations above are
  // already final by this point and are never touched again.
  if (inputName === "Acer palmatum") {
    warnings.push(...checkAcerSpeciesDrift({ sourceRecords, observations }));
  } else if (inputName === "Acer palmatum 'Bloodgood'") {
    warnings.push(...checkBloodgoodDrift({ sourceRecords }));
  }

  return {
    input: { name: inputName, type: inputType },
    taxonomy: composeTaxonomyField(sharedTaxon),
    catalog,
    source_records: sourceRecords,
    trait_observations: observations,
    trait_selections: selections,
    warnings,
    blocked: sharedTaxon.blocked,
  };
}

// buildPlantBatch({ plants, config, rawRoot, cacheDir, refresh }) — builds
// the dry-run bundle for an arbitrary list of { input_name, type } inputs
// (one or many taxon families, each with zero or more cultivars). Output
// order matches input order exactly. Each taxon family (species + its
// cultivars, grouped by parsed parent name via planBatchGrouping) gets
// exactly ONE WCVP lookup, shared across every entry in that family — never
// one call per input — so entries sharing a parent are structurally
// guaranteed to share the same taxon_ref, and a cultivar's
// parent_catalog_ref is always the real catalog_ref of its species sibling
// elsewhere in this same batch (spec §6). This generalizes the original
// Acer/Bloodgood pair (still exactly reproduced when `plants` has just
// those 2 entries) to any batch size.
//
// cacheDir/refresh (both optional) wire in the provider fetch cache
// (providerCache.js): when cacheDir is provided, every WCVP/Perenual/Trefle
// call in this batch goes through ONE shared cached-fetch instance instead
// of a real fetchJson call — cache-first unless refresh=true. Omitting
// cacheDir preserves the exact prior behavior (always a real network call)
// for any other caller that doesn't pass it. The cache affects retrieval
// ONLY — every step below it (normalization, crosswalks, observations,
// selections) always runs on whatever raw data comes back, fresh or
// cached, with today's code.
export async function buildPlantBatch({ plants, config, rawRoot, cacheDir = null, refresh = false }) {
  const fetchImpl = cacheDir ? createCachedFetch({ cacheDir, refresh }) : fetchJson;
  const { plan } = planBatchGrouping(plants);

  const sharedTaxonByParent = new Map();
  for (const parentName of new Set(plan.map((p) => p.parentName))) {
    sharedTaxonByParent.set(parentName, await resolveSharedTaxon(parentName, { rawRoot, fetchImpl }));
  }

  const entries = [];
  for (const p of plan) {
    entries.push(
      await buildPlantEntry({
        inputName: p.input_name,
        inputType: p.type,
        sharedTaxon: sharedTaxonByParent.get(p.parentName),
        catalogRefValue: p.catalogRef,
        parentCatalogRef: p.parentCatalogRef,
        config,
        rawRoot,
        fetchImpl,
      })
    );
  }

  return {
    generated_at: new Date().toISOString(),
    mode: "dry_run",
    plants: entries,
  };
}
