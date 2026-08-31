import { validateBundleForCompilation } from "./validate.js";
import { dedupeTaxa, dedupeTaxonNames } from "./dedupeTaxonomy.js";
import { compileCatalogEntries } from "./compileCatalog.js";
import { compileSourceRecords } from "./compileSourceRecords.js";
import { compileObservations } from "./compileObservations.js";
import { compileSelections } from "./compileSelections.js";
import { runInvariants } from "./invariants.js";

// compileTransactionPlan(bundle) -> { ok: true, plan } | { ok: false, errors }
// Pure (no I/O, no Supabase client, no SQL — layer B only, spec §2). Never
// mutates or "fixes" the input bundle to make it pass — every rule
// violation is collected as an explicit error and compilation fails
// (§4/§6: "Ne modifie jamais le bundle pour le faire passer : FAIL
// explicite"). Symbolic refs only throughout — no production UUID is ever
// invented here (spec §5).
export function compileTransactionPlan(bundle) {
  const inputErrors = validateBundleForCompilation(bundle);
  if (inputErrors.length > 0) {
    return { ok: false, errors: inputErrors };
  }

  const plants = bundle.plants;
  const errors = [];

  const taxaResult = dedupeTaxa(plants);
  errors.push(...taxaResult.errors);

  const taxonNamesResult = dedupeTaxonNames(plants);
  errors.push(...taxonNamesResult.errors);

  const catalogResult = compileCatalogEntries(plants);
  errors.push(...catalogResult.errors);

  const sourceRecordsResult = compileSourceRecords(plants);
  errors.push(...sourceRecordsResult.errors);

  const observationsResult = compileObservations(plants, sourceRecordsResult.sourceRecords);
  errors.push(...observationsResult.errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Selections + catalog promotion happen in the same logical step
  // (spec §8) — compileSelections mutates catalogResult.catalogEntries.
  const selectionsResult = compileSelections(plants, observationsResult.observations, catalogResult.catalogEntries);
  errors.push(...selectionsResult.errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const invariantErrors = runInvariants({
    taxa: taxaResult.taxa,
    taxonNames: taxonNamesResult.taxonNames,
    catalogEntries: catalogResult.catalogEntries,
    sourceRecords: sourceRecordsResult.sourceRecords,
    observations: observationsResult.observations,
    selections: selectionsResult.selections,
  });
  if (invariantErrors.length > 0) {
    return { ok: false, errors: invariantErrors };
  }

  const plan = {
    generated_at: new Date().toISOString(),
    source_bundle_generated_at: bundle.generated_at ?? null,
    mode: "transaction_plan",
    approval_required: true,
    summary: {
      taxa: taxaResult.taxa.length,
      taxon_names: taxonNamesResult.taxonNames.length,
      catalog_entries: catalogResult.catalogEntries.length,
      source_records: sourceRecordsResult.sourceRecords.length,
      trait_observations: observationsResult.observations.length,
      trait_selections: selectionsResult.selections.length,
    },
    taxa: taxaResult.taxa,
    taxon_names: taxonNamesResult.taxonNames,
    catalog_entries: catalogResult.catalogEntries,
    source_records: sourceRecordsResult.sourceRecords,
    trait_observations: observationsResult.observations,
    trait_selections: selectionsResult.selections,
    warnings: bundle.plants.flatMap((p) => p.warnings || []),
  };

  return { ok: true, plan };
}
