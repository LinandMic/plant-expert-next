// READ-ONLY snapshot of the lot's current plant_catalog rows (and their
// preferred French common name), so decide.js can re-check values that
// are already present with the same agreement rule. Only SELECTs — this
// module never inserts, updates or deletes anything.

const COLUMNS = "slug, taxon_id, publication_status, plant_type, sun, height_min_cm, height_max_cm, spread_max_cm, evergreen, water_need, flowering_months";

export async function loadSnapshot(client, slugs) {
  const { data: rows, error } = await client.from("plant_catalog").select(COLUMNS).in("slug", slugs);
  if (error) throw new Error(`snapshot: plant_catalog read failed: ${error.message}`);

  const taxonIds = [...new Set((rows || []).map((r) => r.taxon_id).filter(Boolean))];
  const preferredByTaxon = new Map();
  if (taxonIds.length) {
    const { data: names, error: namesError } = await client
      .from("plant_common_names")
      .select("taxon_id, name")
      .in("taxon_id", taxonIds)
      .eq("locale", "fr")
      .eq("is_preferred", true);
    if (namesError) throw new Error(`snapshot: plant_common_names read failed: ${namesError.message}`);
    for (const n of names || []) preferredByTaxon.set(n.taxon_id, n.name);
  }

  const snapshot = {};
  for (const r of rows || []) {
    snapshot[r.slug] = { ...r, preferred_common_name_fr: preferredByTaxon.get(r.taxon_id) ?? null };
  }
  return snapshot;
}
