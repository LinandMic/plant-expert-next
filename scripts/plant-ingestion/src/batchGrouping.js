// Pure grouping/validation logic for a Layer A input batch of ANY size —
// extracted out of bundle.js so it can be unit tested without a network
// call (bundle.js's own orchestration does real network I/O via
// queryWcvp/queryPerenual/queryTrefle and is deliberately NOT unit tested
// directly — see bundle.js's file-level comment; this is the pure part of
// what used to be hardcoded to exactly one species+cultivar pair).
import { parseCultivarName } from "../../plant-benchmark/src/taxonomyMatch.js";
import { taxonRef, catalogRef } from "./refs.js";

// planBatchGrouping(plants) -> { plan, uniqueParentNames }
//
// For an arbitrary list of { input_name, type } inputs, determines:
//   - which single WCVP lookup (by parent/species name) each input belongs
//     to. A species and any of its cultivars in the same batch always
//     share one taxon family, resolved exactly once — never one WCVP call
//     per input (spec §6) — the same guarantee the original Acer/Bloodgood
//     pair had, now generalized to any number of taxon families in one
//     batch, and to species with zero, one, or several cultivars.
//   - each input's deterministic catalog_ref and (for a cultivar) its
//     parent_catalog_ref — pure string derivations from refs.js, so they
//     never depend on network/build order: a cultivar's parent_catalog_ref
//     is always computable up front, whether its species sibling is built
//     before or after it.
//
// Never silently drops or guesses at a malformed row — every validation
// failure throws with the offending input_name named explicitly:
//   - a cultivar whose parsed parent name has no matching "species" entry
//     in the same batch (Layer C's own guardPlan would reject that catalog
//     entry's parent_catalog_ref anyway — failing here is earlier and
//     clearer);
//   - a declared type that doesn't match what the name itself says (a
//     "cultivar" entry with no quoted cultivar suffix, or a "species"
//     entry that has one);
//   - a duplicate input_name.
export function planBatchGrouping(plants) {
  if (!Array.isArray(plants) || plants.length === 0) {
    throw new Error("planBatchGrouping: plants must be a non-empty array");
  }

  const parsed = plants.map((p) => {
    if (!p || typeof p.input_name !== "string" || !p.input_name.trim()) {
      throw new Error(`planBatchGrouping: every entry needs a non-empty input_name, got ${JSON.stringify(p)}`);
    }
    if (p.type !== "species" && p.type !== "cultivar") {
      throw new Error(`planBatchGrouping: "${p.input_name}" has an invalid type ${JSON.stringify(p.type)} (must be "species" or "cultivar")`);
    }
    const { parentName, cultivarName } = parseCultivarName(p.input_name);
    if (p.type === "cultivar" && !cultivarName) {
      throw new Error(`planBatchGrouping: "${p.input_name}" is declared type="cultivar" but has no quoted cultivar name (expected format: Parent name 'Cultivar')`);
    }
    if (p.type === "species" && cultivarName) {
      throw new Error(`planBatchGrouping: "${p.input_name}" is declared type="species" but its name contains a quoted cultivar suffix`);
    }
    return { input_name: p.input_name, type: p.type, parentName, cultivarName };
  });

  const seenNames = new Set();
  for (const p of parsed) {
    if (seenNames.has(p.input_name)) {
      throw new Error(`planBatchGrouping: duplicate input_name "${p.input_name}"`);
    }
    seenNames.add(p.input_name);
  }

  const speciesParentNames = new Set(parsed.filter((p) => p.type === "species").map((p) => p.parentName));
  for (const p of parsed) {
    if (p.type === "cultivar" && !speciesParentNames.has(p.parentName)) {
      throw new Error(`planBatchGrouping: cultivar "${p.input_name}" has no matching species entry "${p.parentName}" in this batch`);
    }
  }

  const plan = parsed.map((p) => {
    const taxonSlug = taxonRef(p.parentName);
    const speciesCatalogRef = catalogRef({ taxonSlug });
    const isCultivar = p.type === "cultivar";
    return {
      input_name: p.input_name,
      type: p.type,
      parentName: p.parentName,
      cultivarName: p.cultivarName,
      catalogRef: isCultivar ? catalogRef({ taxonSlug, cultivarName: p.cultivarName }) : speciesCatalogRef,
      parentCatalogRef: isCultivar ? speciesCatalogRef : null,
    };
  });

  const uniqueParentNames = [...new Set(parsed.map((p) => p.parentName))];

  return { plan, uniqueParentNames };
}
