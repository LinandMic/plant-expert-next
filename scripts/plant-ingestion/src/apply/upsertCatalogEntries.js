// Layer C, table 3: plant_catalog.
//
// Natural key: slug (real unique constraint: plant_catalog_slug_unique).
//
// CRITICAL safety rule: publication_status, review_status and published_at
// are CURATOR-OWNED fields. Layer B's own invariants O/P guarantee every
// plan always carries publication_status="draft" and review_status=
// "unreviewed" for every entry (see src/plan/invariants.js) — a plan can
// never say otherwise. A curator may promote a row to "published"/
// "reviewed" by hand after ingestion (this already happened for the Acer
// pair in production). If an update ever wrote the plan's draft/unreviewed
// values back over an existing row, re-running the SAME plan would silently
// un-publish already-curated entries. So: these 3 fields are only ever set
// on INSERT (first creation), and are NEVER included in an UPDATE — this
// file does not even read them back for the diff comparison.
const CATALOG_INGESTION_FIELDS = [
  "display_name", "common_name", "entry_type", "cultivar_name",
  "plant_type", "growth_form", "height_min_cm", "height_max_cm", "spread_max_cm",
  "sun", "hardiness_min_rank", "hardiness_max_rank", "evergreen", "water_need",
  "container_suitable", "edible", "flowering_months",
];

function catalogRowFromPlan(c, taxonId, parentCatalogId) {
  return {
    taxon_id: taxonId,
    parent_catalog_id: parentCatalogId,
    entry_type: c.entry_type,
    cultivar_name: c.cultivar_name ?? null,
    display_name: c.display_name,
    common_name: c.common_name ?? null,
    slug: c.slug,
    plant_type: c.plant_type ?? null,
    growth_form: c.growth_form ?? null,
    height_min_cm: c.height_min_cm ?? null,
    height_max_cm: c.height_max_cm ?? null,
    spread_max_cm: c.spread_max_cm ?? null,
    sun: c.sun ?? null,
    hardiness_min_rank: c.hardiness_min_rank ?? null,
    hardiness_max_rank: c.hardiness_max_rank ?? null,
    evergreen: c.evergreen ?? null,
    water_need: c.water_need ?? null,
    container_suitable: c.container_suitable ?? null,
    edible: c.edible ?? null,
    flowering_months: c.flowering_months ?? null,
  };
}

function ingestionFieldsDiffer(existingRow, planRow) {
  return CATALOG_INGESTION_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(planRow[field] ?? null));
}

// Species entries have no parent and must be processed (and resolved)
// before any cultivar that references them, regardless of the plan array's
// own order — the compiler already orders this way (see plan/compiler.js),
// this is defense-in-depth, not a correction of a normally-ordered plan.
function orderSpeciesBeforeCultivars(catalogEntries) {
  const species = catalogEntries.filter((c) => c.entry_type === "species");
  const cultivars = catalogEntries.filter((c) => c.entry_type !== "species");
  return [...species, ...cultivars];
}

// upsertCatalogEntries({ client, catalogEntries, taxonIdByRef, dryRun }) -> { idByRef, created, updated, unchanged, errors }
export async function upsertCatalogEntries({ client, catalogEntries, taxonIdByRef, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  let created = 0, updated = 0, unchanged = 0;

  for (const c of orderSpeciesBeforeCultivars(catalogEntries)) {
    const taxonId = taxonIdByRef.get(c.taxon_ref);
    const parentCatalogId = c.parent_catalog_ref ? idByRef.get(c.parent_catalog_ref) ?? null : null;

    if (!taxonId || (c.parent_catalog_ref && !parentCatalogId)) {
      // Parent taxon (or, for a cultivar, parent species) doesn't exist yet
      // — this entry would be created alongside it.
      created += 1;
      idByRef.set(c.catalog_ref, null);
      continue;
    }

    const { data: existing, error: selectError } = await client
      .from("plant_catalog")
      .select(["id", ...CATALOG_INGESTION_FIELDS].join(", "))
      .eq("slug", c.slug)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_catalog lookup failed for slug "${c.slug}": ${selectError.message}`);
      idByRef.set(c.catalog_ref, null);
      continue;
    }

    const row = catalogRowFromPlan(c, taxonId, parentCatalogId);

    if (!existing) {
      created += 1;
      if (dryRun) {
        idByRef.set(c.catalog_ref, null);
        continue;
      }
      // Only on first creation: publication_status/review_status/published_at
      // take the plan's values (always draft/unreviewed/null per invariants O/P).
      const insertRow = { ...row, publication_status: c.publication_status, review_status: c.review_status, published_at: c.published_at ?? null };
      const { data: inserted, error: insertError } = await client.from("plant_catalog").insert(insertRow).select("id").single();
      if (insertError) {
        errors.push(`plant_catalog insert failed for slug "${c.slug}": ${insertError.message}`);
        idByRef.set(c.catalog_ref, null);
        continue;
      }
      idByRef.set(c.catalog_ref, inserted.id);
      continue;
    }

    idByRef.set(c.catalog_ref, existing.id);
    if (!ingestionFieldsDiffer(existing, row)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (dryRun) continue;
    // Deliberately excludes publication_status/review_status/published_at —
    // see the file-level comment above.
    const { error: updateError } = await client.from("plant_catalog").update(row).eq("id", existing.id);
    if (updateError) errors.push(`plant_catalog update failed for slug "${c.slug}": ${updateError.message}`);
  }

  return { idByRef, created, updated, unchanged, errors };
}
