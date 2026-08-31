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
//   3. Dependency-aware error propagation (NOT fail-fast on the whole
//      pipeline): a step's errors are collected and returned, and any
//      downstream table whose real FK depends on that step is SKIPPED
//      rather than run against ids it cannot trust — see "FK dependency
//      graph" below. A step whose FK does not depend on a failing step
//      still runs normally. Nothing fails or gets skipped silently: every
//      skipped step is reported with status:"skipped" and an explicit
//      reason, and is never counted as created/updated/unchanged.
//
// FK dependency graph (from the real migration, supabase/migrations/
// 20260823124800_create_plant_finder_catalog_v1.sql):
//   plant_taxa                (root)
//   plant_taxon_names         -> plant_taxa only
//   plant_catalog             -> plant_taxa only (NOT plant_taxon_names)
//   plant_source_records      -> plant_catalog only
//   plant_trait_observations  -> plant_catalog, plant_source_records (nullable)
//   plant_trait_selections    -> plant_catalog, plant_trait_observations
//
// So: a plant_taxa failure stops everything (every other table depends on
// it, directly or transitively). A plant_taxon_names failure blocks
// nothing else — no table reads plant_taxon_names by FK. A plant_catalog
// failure blocks source_records/observations/selections. A
// plant_source_records failure blocks observations/selections. A
// plant_trait_observations failure blocks selections only.
//
// This is deliberately table-granular, not row-granular: a single bad row
// in a step skips the ENTIRE downstream table, even for unrelated rows
// that would have succeeded. That's a coarser safety margin than strictly
// necessary, chosen because Layer C has no cross-table transaction to fall
// back on — see the file-level note above and the README.
import { guardPlan } from "./planGuard.js";
import { upsertTaxa, upsertTaxonNames } from "./upsertTaxonomy.js";
import { upsertCatalogEntries } from "./upsertCatalogEntries.js";
import { upsertSourceRecords } from "./upsertSourceRecords.js";
import { upsertObservations } from "./upsertObservations.js";
import { upsertSelections } from "./upsertSelections.js";

function completedStep(result) {
  return { status: "ok", ...result };
}

// A step that was never run because a table it FKs to failed. Always
// shaped like a completed step (created/updated/unchanged/errors all
// present and zero/empty) so callers never need to special-case it, plus
// idByRef: new Map() so a step that WOULD have been skip-cascaded further
// downstream can still look up refs without crashing (finding nothing,
// which is correct — nothing was created).
function skippedStep(reason) {
  return { status: "skipped", reason, created: 0, updated: 0, unchanged: 0, errors: [], idByRef: new Map() };
}

function finalizeReport({ dryRun, steps }) {
  const totals = Object.values(steps).reduce(
    (acc, step) => ({
      created: acc.created + step.created,
      updated: acc.updated + (step.updated ?? 0),
      unchanged: acc.unchanged + step.unchanged,
      errors: acc.errors + step.errors.length,
      skipped: acc.skipped + (step.status === "skipped" ? 1 : 0),
    }),
    { created: 0, updated: 0, unchanged: 0, errors: 0, skipped: 0 }
  );

  return {
    ok: totals.errors === 0,
    dryRun,
    guardErrors: [],
    steps,
    totals,
  };
}

// applyPlan({ client, plan, dryRun }) -> report
// dryRun defaults to true — callers must pass dryRun:false explicitly to
// write anything. This mirrors the CLI's own default-safe posture at the
// function level, not just at the argument-parsing level. The dependency
// skip logic below applies identically in dry-run: a dry-run that hits a
// parent-step error (even just from a failed read) never pretends the
// children could safely be applied — it reports them skipped too.
export async function applyPlan({ client, plan, dryRun = true }) {
  const guardErrors = guardPlan(plan);
  if (guardErrors.length > 0) {
    return {
      ok: false,
      dryRun,
      guardErrors,
      steps: {},
      totals: { created: 0, updated: 0, unchanged: 0, errors: guardErrors.length, skipped: 0 },
    };
  }

  const steps = {};

  steps.taxa = completedStep(await upsertTaxa({ client, taxa: plan.taxa, dryRun }));
  if (steps.taxa.errors.length > 0) {
    // Root of the dependency graph: everything else depends on plant_taxa,
    // directly or transitively. Stop the whole pipeline.
    steps.taxon_names = skippedStep("dependency_error: plant_taxa");
    steps.catalog_entries = skippedStep("dependency_error: plant_taxa");
    steps.source_records = skippedStep("dependency_error: plant_taxa");
    steps.trait_observations = skippedStep("dependency_error: plant_taxa");
    steps.trait_selections = skippedStep("dependency_error: plant_taxa");
    return finalizeReport({ dryRun, steps });
  }

  // plant_taxon_names FKs to plant_taxa only — nothing downstream reads it
  // by FK, so its own errors never block catalog_entries or anything under it.
  steps.taxon_names = completedStep(await upsertTaxonNames({ client, taxonNames: plan.taxon_names, taxonIdByRef: steps.taxa.idByRef, dryRun }));

  // plant_catalog FKs to plant_taxa only (not to plant_taxon_names).
  steps.catalog_entries = completedStep(await upsertCatalogEntries({ client, catalogEntries: plan.catalog_entries, taxonIdByRef: steps.taxa.idByRef, dryRun }));
  if (steps.catalog_entries.errors.length > 0) {
    steps.source_records = skippedStep("dependency_error: plant_catalog");
    steps.trait_observations = skippedStep("dependency_error: plant_catalog");
    steps.trait_selections = skippedStep("dependency_error: plant_catalog");
    return finalizeReport({ dryRun, steps });
  }

  // plant_source_records FKs to plant_catalog only.
  steps.source_records = completedStep(await upsertSourceRecords({ client, sourceRecords: plan.source_records, catalogIdByRef: steps.catalog_entries.idByRef, dryRun }));
  if (steps.source_records.errors.length > 0) {
    steps.trait_observations = skippedStep("dependency_error: plant_source_records");
    steps.trait_selections = skippedStep("dependency_error: plant_source_records");
    return finalizeReport({ dryRun, steps });
  }

  // plant_trait_observations FKs to plant_catalog and (nullably, for
  // non-editorial rows) plant_source_records.
  steps.trait_observations = completedStep(
    await upsertObservations({
      client,
      observations: plan.trait_observations,
      catalogIdByRef: steps.catalog_entries.idByRef,
      sourceRecordIdByRef: steps.source_records.idByRef,
      dryRun,
    })
  );
  if (steps.trait_observations.errors.length > 0) {
    steps.trait_selections = skippedStep("dependency_error: plant_trait_observations");
    return finalizeReport({ dryRun, steps });
  }

  // plant_trait_selections FKs to plant_catalog and plant_trait_observations.
  steps.trait_selections = completedStep(
    await upsertSelections({
      client,
      selections: plan.trait_selections,
      catalogIdByRef: steps.catalog_entries.idByRef,
      observationIdByRef: steps.trait_observations.idByRef,
      dryRun,
    })
  );

  return finalizeReport({ dryRun, steps });
}
