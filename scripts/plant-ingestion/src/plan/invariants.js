import { planError } from "./errors.js";
import { isInformative } from "../informative.js";

function normalizeCultivarName(name) {
  return (name || "").toLowerCase().trim();
}

// runInvariants(plan) -> planError[]
// Pure, read-only, defense-in-depth: independently re-verifies invariants
// A-P (spec §12) against the fully ASSEMBLED plan, even though most are
// already enforced by the individual compile steps — a single place that
// maps directly to the spec's lettered list for audit.
export function runInvariants({ taxa, taxonNames, catalogEntries, sourceRecords, observations, selections }) {
  const errors = [];

  // A. one taxon per wcvp_taxon_id.
  const wcvpIds = taxa.map((t) => t.wcvp_taxon_id);
  if (new Set(wcvpIds).size !== wcvpIds.length) {
    errors.push(planError("INVARIANT_A_DUPLICATE_TAXON", "More than one plant_taxa row shares the same wcvp_taxon_id"));
  }

  // B. exactly one accepted name per taxon.
  for (const taxon of taxa) {
    const acceptedCount = taxonNames.filter((n) => n.taxon_ref === taxon.taxon_ref && n.name_type === "accepted").length;
    if (acceptedCount !== 1) {
      errors.push(planError("INVARIANT_B_ACCEPTED_NAME_COUNT", `Taxon ${taxon.taxon_ref} has ${acceptedCount} accepted name(s), expected exactly 1`, { taxon_ref: taxon.taxon_ref }));
    }
  }

  // C. no duplicate taxon_ref+normalized_name.
  const nameKeys = taxonNames.map((n) => `${n.taxon_ref}:${n.normalized_name}`);
  if (new Set(nameKeys).size !== nameKeys.length) {
    errors.push(planError("INVARIANT_C_DUPLICATE_TAXON_NAME", "More than one plant_taxon_names row shares the same taxon_ref+normalized_name"));
  }

  // D. one species catalog entry per taxon.
  const speciesByTaxon = new Map();
  for (const entry of catalogEntries) {
    if (entry.entry_type !== "species") continue;
    speciesByTaxon.set(entry.taxon_ref, (speciesByTaxon.get(entry.taxon_ref) || 0) + 1);
  }
  for (const [taxonRef, count] of speciesByTaxon) {
    if (count > 1) errors.push(planError("INVARIANT_D_DUPLICATE_SPECIES", `Taxon ${taxonRef} has ${count} species catalog entries, expected at most 1`, { taxon_ref: taxonRef }));
  }

  // E. no duplicate normalized cultivar name per taxon.
  const cultivarKeys = catalogEntries.filter((e) => e.entry_type === "cultivar").map((e) => `${e.taxon_ref}:${normalizeCultivarName(e.cultivar_name)}`);
  if (new Set(cultivarKeys).size !== cultivarKeys.length) {
    errors.push(planError("INVARIANT_E_DUPLICATE_CULTIVAR", "More than one cultivar catalog entry shares the same taxon_ref+normalized cultivar_name"));
  }

  // F. cultivar parent exists and is species.
  const catalogByRef = new Map(catalogEntries.map((e) => [e.catalog_ref, e]));
  for (const entry of catalogEntries) {
    if (entry.entry_type !== "cultivar") continue;
    const parent = catalogByRef.get(entry.parent_catalog_ref);
    if (!parent || parent.entry_type !== "species") {
      errors.push(planError("INVARIANT_F_CULTIVAR_PARENT", `Cultivar ${entry.catalog_ref} has no valid species parent`, { catalog_ref: entry.catalog_ref }));
    }
  }

  // G. unique source_record_ref.
  const srRefs = sourceRecords.map((s) => s.source_record_ref);
  if (new Set(srRefs).size !== srRefs.length) {
    errors.push(planError("INVARIANT_G_DUPLICATE_SOURCE_RECORD", "More than one plant_source_records row shares the same source_record_ref"));
  }

  // H. unique observation_ref.
  const obsRefs = observations.map((o) => o.observation_ref);
  if (new Set(obsRefs).size !== obsRefs.length) {
    errors.push(planError("INVARIANT_H_DUPLICATE_OBSERVATION", "More than one plant_trait_observations row shares the same observation_ref"));
  }

  // I. external-provider observation resolves to the source record of the
  // SAME catalog_ref+provider.
  const srKeys = new Set(sourceRecords.map((s) => `${s.catalog_ref}:${s.provider}`));
  for (const obs of observations) {
    if (obs.provider === "editorial") continue;
    if (!srKeys.has(`${obs.catalog_ref}:${obs.provider}`)) {
      errors.push(planError("INVARIANT_I_OBSERVATION_SOURCE", `Observation ${obs.observation_ref} does not resolve to a source record for its own catalog_ref+provider`, { observation_ref: obs.observation_ref }));
    }
  }

  // J/K/L/M/N — selections.
  const observationsByRef = new Map(observations.map((o) => [o.observation_ref, o]));
  const selectionKeys = new Set();
  for (const sel of selections) {
    const key = `${sel.catalog_ref}:${sel.trait}`;
    if (selectionKeys.has(key)) {
      errors.push(planError("INVARIANT_K_DUPLICATE_SELECTION", `More than one selection for ${key}`, { key }));
    }
    selectionKeys.add(key);

    const obs = observationsByRef.get(sel.selected_observation_ref);
    if (!obs || obs.catalog_ref !== sel.catalog_ref || obs.trait !== sel.trait) {
      errors.push(planError("INVARIANT_J_SELECTION_SCOPE", `Selection ${key} does not point to an observation of the same catalog_ref+trait`, { key }));
      continue;
    }

    if (!isInformative(obs.normalized_value)) {
      errors.push(planError("INVARIANT_M_NULL_SELECTION", `Selection ${key} references an observation with a non-informative normalized_value`, { key }));
      continue;
    }

    const catalogEntry = catalogByRef.get(sel.catalog_ref);
    if (!catalogEntry || JSON.stringify(catalogEntry[sel.trait]) !== JSON.stringify(obs.normalized_value)) {
      errors.push(planError("INVARIANT_N_PROMOTION_MISMATCH", `plant_catalog.${sel.trait} for ${sel.catalog_ref} does not match the promoted selection's value`, { key }));
    }
  }

  // O/P — draft / unreviewed.
  for (const entry of catalogEntries) {
    if (entry.publication_status !== "draft") {
      errors.push(planError("INVARIANT_O_NOT_DRAFT", `${entry.catalog_ref}: publication_status is "${entry.publication_status}", expected "draft"`, { catalog_ref: entry.catalog_ref }));
    }
    if (entry.review_status !== "unreviewed") {
      errors.push(planError("INVARIANT_P_NOT_UNREVIEWED", `${entry.catalog_ref}: review_status is "${entry.review_status}", expected "unreviewed"`, { catalog_ref: entry.catalog_ref }));
    }
  }

  return errors;
}
