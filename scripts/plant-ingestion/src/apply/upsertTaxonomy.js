// Layer C, tables 1-2: plant_taxa and plant_taxon_names.
//
// Natural keys (both already enforced by real unique constraints in
// supabase/migrations/20260823124800_create_plant_finder_catalog_v1.sql):
//   - plant_taxa: wcvp_taxon_id
//   - plant_taxon_names: (taxon_id, normalized_name)
//
// idByRef maps a plan's symbolic *_ref to either a real DB uuid, or `null`
// meaning "this row does not exist yet" — used both for a genuine dry-run
// (nothing was inserted) and, during a real apply, briefly before the
// insert executes. Downstream upsert steps (catalog, source records, ...)
// must treat a `null` parent id as "my own row cannot exist yet either" and
// report themselves as `created` without attempting a lookup keyed on it.

const TAXA_FIELDS = ["rank", "genus", "species", "infraspecific_epithet", "canonical_name", "scientific_name_full", "family", "taxonomic_status"];

function taxaRowFromPlan(t) {
  return {
    rank: t.rank,
    genus: t.genus,
    species: t.species ?? null,
    infraspecific_epithet: t.infraspecific_epithet ?? null,
    canonical_name: t.canonical_name,
    scientific_name_full: t.scientific_name_full ?? null,
    family: t.family ?? null,
    taxonomic_status: t.taxonomic_status,
    wcvp_taxon_id: t.wcvp_taxon_id,
    // parent_taxon_id is intentionally not set here: no plan produced by
    // Layer B populates it yet (always genus-less species/cultivar-level
    // ingestion in V1) — left to the table's own default (null).
  };
}

function taxaFieldsDiffer(existingRow, planRow) {
  return TAXA_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(planRow[field] ?? null));
}

// upsertTaxa({ client, taxa, dryRun }) -> { idByRef, created, updated, unchanged, errors }
export async function upsertTaxa({ client, taxa, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  let created = 0, updated = 0, unchanged = 0;

  for (const t of taxa) {
    const { data: existing, error: selectError } = await client
      .from("plant_taxa")
      .select("id, rank, genus, species, infraspecific_epithet, canonical_name, scientific_name_full, family, taxonomic_status")
      .eq("wcvp_taxon_id", t.wcvp_taxon_id)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_taxa lookup failed for ${t.taxon_ref} (wcvp_taxon_id=${t.wcvp_taxon_id}): ${selectError.message}`);
      idByRef.set(t.taxon_ref, null);
      continue;
    }

    const row = taxaRowFromPlan(t);

    if (!existing) {
      created += 1;
      if (dryRun) {
        idByRef.set(t.taxon_ref, null);
        continue;
      }
      const { data: inserted, error: insertError } = await client.from("plant_taxa").insert(row).select("id").single();
      if (insertError) {
        errors.push(`plant_taxa insert failed for ${t.taxon_ref}: ${insertError.message}`);
        idByRef.set(t.taxon_ref, null);
        continue;
      }
      idByRef.set(t.taxon_ref, inserted.id);
      continue;
    }

    idByRef.set(t.taxon_ref, existing.id);
    if (!taxaFieldsDiffer(existing, row)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (dryRun) continue;
    const { error: updateError } = await client.from("plant_taxa").update(row).eq("id", existing.id);
    if (updateError) errors.push(`plant_taxa update failed for ${t.taxon_ref}: ${updateError.message}`);
  }

  return { idByRef, created, updated, unchanged, errors };
}

function taxonNameRowFromPlan(n, taxonId) {
  return {
    taxon_id: taxonId,
    name: n.name,
    normalized_name: n.normalized_name,
    name_type: n.name_type,
    source_taxon_id: n.source_taxon_id ?? null,
  };
}

// upsertTaxonNames({ client, taxonNames, taxonIdByRef, dryRun }) -> { created, updated, unchanged, errors }
// No per-row ref map is returned: nothing downstream references a
// taxon_names row by *_ref.
export async function upsertTaxonNames({ client, taxonNames, taxonIdByRef, dryRun }) {
  const errors = [];
  let created = 0, updated = 0, unchanged = 0;

  for (const n of taxonNames) {
    const taxonId = taxonIdByRef.get(n.taxon_ref);
    if (!taxonId) {
      // Parent taxon doesn't exist yet (dry-run, or a prior real failure) —
      // this name would be created alongside it, never a lookup on a null id.
      created += 1;
      continue;
    }

    const { data: existing, error: selectError } = await client
      .from("plant_taxon_names")
      .select("id, name, name_type, source_taxon_id")
      .eq("taxon_id", taxonId)
      .eq("normalized_name", n.normalized_name)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_taxon_names lookup failed for "${n.normalized_name}": ${selectError.message}`);
      continue;
    }

    const row = taxonNameRowFromPlan(n, taxonId);

    if (!existing) {
      created += 1;
      if (dryRun) continue;
      const { error: insertError } = await client.from("plant_taxon_names").insert(row);
      if (insertError) errors.push(`plant_taxon_names insert failed for "${n.normalized_name}": ${insertError.message}`);
      continue;
    }

    const differs = existing.name !== n.name || existing.name_type !== n.name_type || (existing.source_taxon_id ?? null) !== (n.source_taxon_id ?? null);
    if (!differs) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (dryRun) continue;
    const { error: updateError } = await client.from("plant_taxon_names").update(row).eq("id", existing.id);
    if (updateError) errors.push(`plant_taxon_names update failed for "${n.normalized_name}": ${updateError.message}`);
  }

  return { created, updated, unchanged, errors };
}
