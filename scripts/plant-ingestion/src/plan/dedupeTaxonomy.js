import { planError } from "./errors.js";

const TAXON_FIELDS = ["taxon_ref", "rank", "genus", "species", "infraspecific_epithet", "canonical_name", "scientific_name_full", "family", "taxonomic_status", "wcvp_taxon_id"];

function taxaEqual(a, b) {
  return TAXON_FIELDS.every((f) => a[f] === b[f]);
}

// dedupeTaxa(plants) -> { taxa, errors }
// Pure. Same taxon appears once per plant in the bundle (§6) — deduplicated
// by wcvp_taxon_id. Two occurrences with the same wcvp_taxon_id but
// DIFFERENT field values are a contradiction: BLOCK, never silently keep
// the first one (spec §6/§12.A).
export function dedupeTaxa(plants) {
  const errors = [];
  const byWcvpId = new Map();

  for (const plant of plants) {
    if (!plant.taxonomy) continue;
    const { names, ...taxon } = plant.taxonomy;
    const key = taxon.wcvp_taxon_id;
    if (key == null) {
      errors.push(planError("TAXON_MISSING_WCVP_ID", `${plant.input.name}: taxonomy has no wcvp_taxon_id`, { plant: plant.input.name }));
      continue;
    }
    const existing = byWcvpId.get(key);
    if (!existing) {
      byWcvpId.set(key, taxon);
    } else if (!taxaEqual(existing, taxon)) {
      errors.push(planError("TAXON_CONTRADICTION", `Two plants report wcvp_taxon_id=${key} with contradictory taxon fields`, { wcvp_taxon_id: key }));
    }
  }

  return { taxa: [...byWcvpId.values()], errors };
}

const NAME_FIELDS = ["taxon_ref", "name", "normalized_name", "name_type", "source_taxon_id"];

function namesEqual(a, b) {
  return NAME_FIELDS.every((f) => a[f] === b[f]);
}

// dedupeTaxonNames(plants) -> { taxonNames, errors }
// Pure. taxonomy.names is repeated verbatim across every plant sharing the
// same taxon (§7's shared-taxon guarantee) — deduplicated by
// taxon_ref+normalized_name (§6/§12.C). A contradiction (same key,
// different name/name_type/source_taxon_id) is BLOCKED, never resolved by
// picking the first occurrence.
export function dedupeTaxonNames(plants) {
  const errors = [];
  const byKey = new Map();

  for (const plant of plants) {
    if (!plant.taxonomy || !Array.isArray(plant.taxonomy.names)) continue;
    for (const name of plant.taxonomy.names) {
      const key = `${name.taxon_ref}:${name.normalized_name}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, name);
      } else if (!namesEqual(existing, name)) {
        errors.push(planError("TAXON_NAME_CONTRADICTION", `Two plants report ${key} with contradictory name fields`, { key }));
      }
    }
  }

  return { taxonNames: [...byKey.values()], errors };
}
