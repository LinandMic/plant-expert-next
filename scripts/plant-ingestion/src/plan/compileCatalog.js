import { PROMOTABLE_CATALOG_COLUMNS } from "./catalogColumns.js";
import { planError } from "./errors.js";

// compileCatalogEntries(plants) -> { catalogEntries, errors }
// Pure. Orders species before cultivar (spec §7) regardless of input
// order, and verifies a cultivar's parent_catalog_ref both resolves to a
// real entry AND that entry is entry_type=species (spec §7/§12.F) — never
// assumed, always checked. No trait inheritance of any kind.
//
// The bundle's own catalog dry-run object never carries the typed
// hot-filter columns at all (they only ever live as proposals in
// trait_selections until promoted — spec §13/§14 of the collector) —
// every PROMOTABLE_CATALOG_COLUMNS entry is explicitly seeded to `null`
// here (not just omitted) so a trait with no selection reads as an
// explicit, visible "not yet known", never a missing key (spec §8:
// "Toutes les autres colonnes canoniques restent null"). compileSelections
// overwrites only the ones actually promoted.
export function compileCatalogEntries(plants) {
  const errors = [];
  const entries = plants.filter((p) => p.catalog).map((p) => {
    const entry = { ...p.catalog };
    for (const column of PROMOTABLE_CATALOG_COLUMNS) {
      if (!(column in entry)) entry[column] = null;
    }
    return entry;
  });

  entries.sort((a, b) => (a.entry_type === b.entry_type ? 0 : a.entry_type === "species" ? -1 : 1));

  const byCatalogRef = new Map(entries.map((e) => [e.catalog_ref, e]));

  for (const entry of entries) {
    if (entry.entry_type !== "cultivar") continue;
    const parent = byCatalogRef.get(entry.parent_catalog_ref);
    if (!parent) {
      errors.push(planError("CULTIVAR_PARENT_NOT_FOUND", `${entry.catalog_ref}: parent_catalog_ref "${entry.parent_catalog_ref}" does not resolve to any catalog entry in this plan`, { catalog_ref: entry.catalog_ref }));
    } else if (parent.entry_type !== "species") {
      errors.push(planError("CULTIVAR_PARENT_NOT_SPECIES", `${entry.catalog_ref}: parent_catalog_ref "${entry.parent_catalog_ref}" is entry_type="${parent.entry_type}", expected "species"`, { catalog_ref: entry.catalog_ref }));
    }
  }

  return { catalogEntries: entries, errors };
}
