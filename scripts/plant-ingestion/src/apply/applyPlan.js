// Layer C orchestrator: PLAN (already on disk) -> VALIDATE (guardPlan) ->
// APPLY (six per-table upserts, in FK dependency order) -> aggregate report.
//
// No real multi-table Supabase transaction exists here — supabase-js issues
// independent REST calls per table, it cannot wrap them in one atomic
// commit/rollback. This is a known, documented limitation (see the
// project's ingestion README), mitigated by:
//   1. A safe write order: a row is only ever written after every table it
//      references by FK has already been written (taxa -> taxon_names ->
//      catalog_entries -> source_records -> trait_observations ->
//      trait_selections).
//   2. Natural-key upserts throughout: re-running applyPlan after a partial
//      failure never creates a duplicate, it just resumes — already-written
//      rows are looked up and reported "unchanged", not re-inserted.
//   3. Fail-fast is NOT used between tables: a step's errors are collected
//      and returned, but later steps still run for every row whose
//      dependencies did succeed, so a single bad row never blocks the rest
//      of an otherwise-good plan. Every per-row failure is surfaced in the
//      final report's errors array — nothing fails silently.
import { guardPlan } from "./planGuard.js";
import { upsertTaxa, upsertTaxonNames } from "./upsertTaxonomy.js";
import { upsertCatalogEntries } from "./upsertCatalogEntries.js";
import { upsertSourceRecords } from "./upsertSourceRecords.js";
import { upsertObservations } from "./upsertObservations.js";
import { upsertSelections } from "./upsertSelections.js";

function emptyTotals() {
  return { created: 0, updated: 0, unchanged: 0, errors: 0 };
}

// applyPlan({ client, plan, dryRun }) -> report
// dryRun defaults to true — callers must pass dryRun:false explicitly to
// write anything. This mirrors the CLI's own default-safe posture at the
// function level, not just at the argument-parsing level.
export async function applyPlan({ client, plan, dryRun = true }) {
  const guardErrors = guardPlan(plan);
  if (guardErrors.length > 0) {
    return {
      ok: false,
      dryRun,
      guardErrors,
      steps: {},
      totals: { created: 0, updated: 0, unchanged: 0, errors: guardErrors.length },
    };
  }

  const steps = {};

  steps.taxa = await upsertTaxa({ client, taxa: plan.taxa, dryRun });
  steps.taxon_names = await upsertTaxonNames({ client, taxonNames: plan.taxon_names, taxonIdByRef: steps.taxa.idByRef, dryRun });
  steps.catalog_entries = await upsertCatalogEntries({ client, catalogEntries: plan.catalog_entries, taxonIdByRef: steps.taxa.idByRef, dryRun });
  steps.source_records = await upsertSourceRecords({ client, sourceRecords: plan.source_records, catalogIdByRef: steps.catalog_entries.idByRef, dryRun });
  steps.trait_observations = await upsertObservations({
    client,
    observations: plan.trait_observations,
    catalogIdByRef: steps.catalog_entries.idByRef,
    sourceRecordIdByRef: steps.source_records.idByRef,
    dryRun,
  });
  steps.trait_selections = await upsertSelections({
    client,
    selections: plan.trait_selections,
    catalogIdByRef: steps.catalog_entries.idByRef,
    observationIdByRef: steps.trait_observations.idByRef,
    dryRun,
  });

  const allSteps = Object.values(steps);
  const totals = allSteps.reduce(
    (acc, step) => ({
      created: acc.created + step.created,
      updated: acc.updated + (step.updated ?? 0),
      unchanged: acc.unchanged + step.unchanged,
      errors: acc.errors + step.errors.length,
    }),
    emptyTotals()
  );

  return {
    ok: totals.errors === 0,
    dryRun,
    guardErrors: [],
    steps,
    totals,
  };
}
