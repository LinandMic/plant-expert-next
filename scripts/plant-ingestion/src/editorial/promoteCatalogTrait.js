import { stableEqual } from "../apply/stableEqual.js";

// promoteCatalogTrait({ client, catalogId, trait, normalizedValue, dryRun })
//   -> { status: "unchanged" | "updated" | "failed", error? }
//
// The ONLY place an editorial curation ever writes to plant_catalog. This
// is deliberately NOT a reuse of apply/upsertCatalogEntries.js: that
// helper does a FULL-ROW update across all 17 CATALOG_INGESTION_FIELDS
// (display_name, entry_type, all 13 trait columns, ...) sourced from a
// complete catalog_entries plan row — an editorial overlay never has that
// full row (spec: it must never read or create catalog_entries), and
// feeding it a partial/synthetic row would silently null out every OTHER
// trait column on write. This function instead issues a genuinely
// single-column `.update({ [trait]: value })` — the real Supabase/Postgres
// UPDATE only ever touches that one column, so publication_status,
// review_status, published_at, and every other trait column are
// structurally impossible for this function to touch, not just
// conventionally avoided.
export async function promoteCatalogTrait({ client, catalogId, trait, normalizedValue, dryRun }) {
  const { data: existing, error: selectError } = await client
    .from("plant_catalog")
    .select(`id, ${trait}`)
    .eq("id", catalogId)
    .maybeSingle();

  if (selectError) {
    return { status: "failed", error: `plant_catalog lookup failed for id ${catalogId}: ${selectError.message}` };
  }
  if (!existing) {
    return { status: "failed", error: `plant_catalog row ${catalogId} not found` };
  }

  if (stableEqual(existing[trait] ?? null, normalizedValue ?? null)) {
    return { status: "unchanged" };
  }

  if (dryRun) {
    return { status: "updated" };
  }

  const { error: updateError } = await client.from("plant_catalog").update({ [trait]: normalizedValue }).eq("id", catalogId);
  if (updateError) {
    return { status: "failed", error: `plant_catalog promotion failed for id ${catalogId}, trait ${trait}: ${updateError.message}` };
  }
  return { status: "updated" };
}
