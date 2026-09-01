// Pure sub-plan extraction: given a Layer B transaction plan and one or
// more requested catalog_ref values, produces a NEW plan containing only
// those catalog entries and everything they structurally depend on. Never
// mutates the source plan (no array/object on it is ever written to —
// every output array is built with .filter(), which returns a fresh array
// referencing the same row objects, never touching the originals).
//
// This exists so a multi-plant Layer B plan (e.g. a 6-plant pilot batch)
// can be narrowed down to just the entries actually cleared for a real
// apply (e.g. only the one plant that passed quality review), without
// ever hand-editing the plan JSON.
import { guardPlan } from "./apply/planGuard.js";

// A cultivar's parent_catalog_ref must always resolve within the same
// plan (guardPlan itself enforces this — see planGuard.js). So a
// literal "keep only the exact refs requested" filter would produce an
// orphan reference the moment someone requests a cultivar without its
// parent species. Instead: walk parent_catalog_ref chains outward from
// the requested refs and pull in every ancestor needed — "the
// dependencies necessary for this entry", not a blind slice.
function collectCatalogClosure(catalogEntries, requestedRefs) {
  const byRef = new Map(catalogEntries.map((c) => [c.catalog_ref, c]));
  const kept = new Set();
  const queue = [...requestedRefs];
  while (queue.length > 0) {
    const ref = queue.shift();
    if (kept.has(ref)) continue;
    const entry = byRef.get(ref);
    if (!entry) continue; // unknown refs are already rejected by the caller before this runs
    kept.add(ref);
    if (entry.parent_catalog_ref) queue.push(entry.parent_catalog_ref);
  }
  return kept;
}

// filterPlanByCatalogRefs(plan, catalogRefs) -> a new transaction plan
//
// Filtering rule per table (§ "RÈGLES DE FILTRAGE"):
//   plant_catalog            -> kept catalog_entries (requested ∪ their
//                                parent_catalog_ref closure)
//   plant_taxa                -> only taxa referenced by kept catalog_entries
//   plant_taxon_names          -> only names belonging to kept taxa
//   plant_source_records       -> only rows whose catalog_ref is kept
//   plant_trait_observations   -> only rows whose catalog_ref is kept
//   plant_trait_selections     -> only rows whose catalog_ref is kept
//
// Every output array preserves the SOURCE plan's own row order (plain
// .filter(), never re-sorted or rebuilt from a Set/Map) — the result is
// deterministic for a given source plan and request, regardless of the
// order --catalog-ref was passed in.
//
// Throws (never silently produces a partial/empty result) if any
// requested catalog_ref does not exist anywhere in the source plan.
//
// The constructed sub-plan is run through guardPlan itself before being
// returned — the exact same FK-orphan check Layer C relies on — as a
// self-proof that filtering can never produce a dangling reference,
// rather than a separate, potentially-drifting reimplementation of that
// logic.
export function filterPlanByCatalogRefs(plan, catalogRefs) {
  if (!Array.isArray(catalogRefs) || catalogRefs.length === 0) {
    throw new Error("filterPlanByCatalogRefs: catalogRefs must be a non-empty array");
  }

  const allCatalogRefs = new Set(plan.catalog_entries.map((c) => c.catalog_ref));
  const unknown = catalogRefs.filter((ref) => !allCatalogRefs.has(ref));
  if (unknown.length > 0) {
    throw new Error(`filterPlanByCatalogRefs: unknown catalog_ref(s): ${unknown.join(", ")}`);
  }

  const keptCatalogRefs = collectCatalogClosure(plan.catalog_entries, catalogRefs);

  const catalog_entries = plan.catalog_entries.filter((c) => keptCatalogRefs.has(c.catalog_ref));
  const keptTaxonRefs = new Set(catalog_entries.map((c) => c.taxon_ref));

  const taxa = plan.taxa.filter((t) => keptTaxonRefs.has(t.taxon_ref));
  const taxon_names = plan.taxon_names.filter((n) => keptTaxonRefs.has(n.taxon_ref));
  const source_records = plan.source_records.filter((s) => keptCatalogRefs.has(s.catalog_ref));
  const trait_observations = plan.trait_observations.filter((o) => keptCatalogRefs.has(o.catalog_ref));
  const trait_selections = plan.trait_selections.filter((sel) => keptCatalogRefs.has(sel.catalog_ref));

  const filtered = {
    generated_at: new Date().toISOString(),
    source_bundle_generated_at: plan.source_bundle_generated_at ?? null,
    mode: "transaction_plan",
    approval_required: true,
    summary: {
      taxa: taxa.length,
      taxon_names: taxon_names.length,
      catalog_entries: catalog_entries.length,
      source_records: source_records.length,
      trait_observations: trait_observations.length,
      trait_selections: trait_selections.length,
    },
    taxa,
    taxon_names,
    catalog_entries,
    source_records,
    trait_observations,
    trait_selections,
    // Source warnings are plant-level free text, not structurally tied to
    // a catalog_ref — guessing which ones still apply to the kept subset
    // would risk misattributing a warning about an excluded plant.
    // Dropped rather than guessed at.
    warnings: [],
  };

  const guardErrors = guardPlan(filtered);
  if (guardErrors.length > 0) {
    throw new Error(`filterPlanByCatalogRefs: internal consistency check failed (this should never happen): ${guardErrors.join("; ")}`);
  }

  return filtered;
}
