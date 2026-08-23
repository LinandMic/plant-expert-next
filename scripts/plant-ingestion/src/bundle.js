// Orchestration only — network calls are the REUSED, unmodified benchmark
// provider functions (spec §2: "ne duplique pas les clients API"). All
// botanical interpretation (crosswalks, taxon-sharing, selection proposals)
// lives in the pure modules imported below, which is what is unit tested.

import { queryWcvp } from "../../plant-benchmark/src/providers/wcvp.js";
import { queryPerenual } from "../../plant-benchmark/src/providers/perenual.js";
import { queryTrefle } from "../../plant-benchmark/src/providers/trefle.js";
import { parseCultivarName } from "../../plant-benchmark/src/taxonomyMatch.js";

import { taxonRef, catalogRef } from "./refs.js";
import { buildTaxonDryRun, buildTaxonNames } from "./taxonomy.js";
import { buildSpeciesCatalogEntry, buildCultivarCatalogEntry } from "./catalog.js";
import { buildSourceRecord, buildObservations } from "./provenance.js";
import { proposeSelections } from "./selections.js";
import { checkAcerSpeciesDrift, checkBloodgoodDrift } from "./drift.js";

// resolveSharedTaxon(parentName, { rawRoot }) — the ONE WCVP call for a
// species+cultivar pair. Called once for the species input; its result is
// reused for the cultivar too, so the two catalog entries are structurally
// guaranteed to share the same taxon_ref (spec §6) rather than merely
// hoping two separate network calls agree.
async function resolveSharedTaxon(parentName, { rawRoot }) {
  const wcvpResult = await queryWcvp({ inputName: parentName, rawRoot });
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

async function fetchHorticultural(inputName, { rawRoot, config }) {
  const retrievedAt = new Date().toISOString();
  const [perenualResult, trefleResult] = await Promise.all([
    queryPerenual({ inputName, rawRoot, apiKey: config.perenualApiKey, accessTier: config.perenualAccessTier }),
    queryTrefle({ inputName, rawRoot, apiKey: config.trefleApiKey }),
  ]);
  return { perenualResult, trefleResult, retrievedAt };
}

// buildPlantEntry — builds one `plants[]` entry of the dry-run bundle for
// either the species or the cultivar, given the ALREADY-RESOLVED shared
// taxon (from resolveSharedTaxon, called once by buildAcerMiniBatch below).
async function buildPlantEntry({ inputName, inputType, sharedTaxon, catalogRefValue, parentCatalogRef, config, rawRoot }) {
  const warnings = [...sharedTaxon.warnings];
  const { cultivarName } = parseCultivarName(inputName);

  const { perenualResult, trefleResult, retrievedAt } = await fetchHorticultural(inputName, { rawRoot, config });

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
  const observations = [];

  const wcvpSr = buildSourceRecord({ provider: "wcvp", catalogRef: catalogRefValue, result: sharedTaxon.wcvpResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt });
  sourceRecords.push(wcvpSr.source_record);

  const perenualSr = buildSourceRecord({ provider: "perenual", catalogRef: catalogRefValue, result: perenualResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt });
  sourceRecords.push(perenualSr.source_record);
  observations.push(...buildObservations({ provider: "perenual", catalogRef: catalogRefValue, sourceRecordRef: perenualSr.source_record_ref, result: perenualResult }));

  const trefleSr = buildSourceRecord({ provider: "trefle", catalogRef: catalogRefValue, result: trefleResult, wcvpTaxonomy: sharedTaxon.wcvpTaxonomy, retrievedAt });
  sourceRecords.push(trefleSr.source_record);
  observations.push(...buildObservations({ provider: "trefle", catalogRef: catalogRefValue, sourceRecordRef: trefleSr.source_record_ref, result: trefleResult }));

  let selections = [];
  if (catalog) {
    const proposed = proposeSelections({ catalogRef: catalogRefValue, observations });
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

// buildAcerMiniBatch({ config, rawRoot }) — builds the full 2-plant dry-run
// bundle. Exactly the 2 target plants, in this exact order (species first,
// so the cultivar can reuse its resolved taxon).
export async function buildAcerMiniBatch({ speciesInput, cultivarInput, config, rawRoot }) {
  const { parentName: speciesParentName } = parseCultivarName(speciesInput.input_name);
  const { cultivarName } = parseCultivarName(cultivarInput.input_name);

  const sharedTaxon = await resolveSharedTaxon(speciesParentName, { rawRoot });

  const taxonSlug = taxonRef(speciesParentName);
  const speciesCatalogRef = catalogRef({ taxonSlug });
  const cultivarCatalogRef = catalogRef({ taxonSlug, cultivarName });

  const speciesEntry = await buildPlantEntry({
    inputName: speciesInput.input_name,
    inputType: speciesInput.type,
    sharedTaxon,
    catalogRefValue: speciesCatalogRef,
    parentCatalogRef: null,
    config,
    rawRoot,
  });

  const cultivarEntry = await buildPlantEntry({
    inputName: cultivarInput.input_name,
    inputType: cultivarInput.type,
    sharedTaxon,
    catalogRefValue: cultivarCatalogRef,
    parentCatalogRef: speciesCatalogRef,
    config,
    rawRoot,
  });

  return {
    generated_at: new Date().toISOString(),
    mode: "dry_run",
    plants: [speciesEntry, cultivarEntry],
  };
}
