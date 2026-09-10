import { supabase } from "./supabaseClient.js";
import { normalizePlantFinderFilters, heightCategoryBounds } from "./plantFinderFilters.js";

// Read-only access to the public Plant Finder catalog. Uses the SAME
// browser/anon Supabase client as the rest of the app — no service_role,
// no separate admin path. RLS (plant_catalog_published_select) already
// restricts anon/authenticated to publication_status='published' rows; the
// explicit .eq("publication_status", "published") below is defense in
// depth, never a substitute for RLS, and it means a draft row is never
// reachable through this API even if RLS were ever misconfigured.

const LIST_SELECT = [
  "id",
  "slug",
  "entry_type",
  "cultivar_name",
  "display_name",
  "common_name",
  "plant_type",
  "growth_form",
  "height_min_cm",
  "height_max_cm",
  "spread_max_cm",
  "sun",
  "evergreen",
  "water_need",
  "container_suitable",
  "edible",
  "flowering_months",
  "image_url",
  "image_alt",
  "image_author",
  "image_license",
  "image_source_url",
  "plant_taxa ( canonical_name, family, genus )",
].join(", ");

export function rowToPlant(row) {
  return {
    id: row.id,
    slug: row.slug,
    entryType: row.entry_type,
    cultivarName: row.cultivar_name,
    displayName: row.display_name,
    commonName: row.common_name,
    plantType: row.plant_type,
    growthForm: row.growth_form,
    heightMinCm: row.height_min_cm,
    heightMaxCm: row.height_max_cm,
    spreadMaxCm: row.spread_max_cm,
    sun: row.sun,
    evergreen: row.evergreen,
    waterNeed: row.water_need,
    containerSuitable: row.container_suitable,
    edible: row.edible,
    floweringMonths: row.flowering_months,
    imageUrl: row.image_url ?? null,
    imageAlt: row.image_alt ?? null,
    imageAuthor: row.image_author ?? null,
    imageLicense: row.image_license ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    taxon: row.plant_taxa
      ? {
          canonicalName: row.plant_taxa.canonical_name,
          family: row.plant_taxa.family,
          genus: row.plant_taxa.genus,
        }
      : null,
  };
}

// PostgREST's .or() filter syntax treats "," and "()" as structural — a
// search value containing one of those must never be able to alter the
// filter's shape. "\\" itself is escaped first so escaping is unambiguous.
function escapeForOrFilter(value) {
  return value.replace(/[\\,()]/g, (char) => `\\${char}`);
}

// searchPublishedPlants({ query, plantType, sun, heightCategory, limit, offset })
//   -> { plants: Plant[], hasMore: boolean, total: number }
// Every filter value is run through normalizePlantFinderFilters() first —
// this function never trusts its caller to have already sanitized input,
// so an unknown/tampered plantType, sun, heightCategory, limit, or offset
// can never reach the query builder. No query/filters: `limit` published
// plants starting at `offset`, alphabetical by display_name (with `id` as
// a stable tie-break — two rows can share the exact same display_name, and
// without a second, unique sort key their relative order across separate
// range() pages would be arbitrary, risking a skipped or duplicated row on
// "Charger plus"). Sun uses OR/overlap semantics (a plant matches if it has
// at least one selected exposure); a plant with sun=null never matches an
// active exposition filter, by construction of .overlaps() against a null
// array column. Height filtering is done on height_max_cm only (never
// height_min_cm); a null height_max_cm never matches an active height
// filter, for the same reason.
//
// hasMore is determined deterministically by requesting ONE extra row
// (range(offset, offset+limit) is `limit+1` rows inclusive) — if it comes
// back, there is at least one more row beyond this page, and that extra
// row is trimmed off before returning; it is never rendered. This is
// independent of `total` below (no dependency between the two), and never
// depends on limit/hasMore being confused with each other.
//
// total is the real count of published rows matching the current
// filters/search — computed by PostgREST itself via `count: "exact"` on
// the SAME query (same .eq/.or/.overlaps/.gt/.lte chain, before .range()
// trims it to one page), so it always reflects the active filters, never
// just how many cards happen to be loaded client-side. One request, no
// extra round-trip: `count` comes back alongside `data` on this single
// call.
export async function searchPublishedPlants(params) {
  const { query, plantType, sun, heightCategory, limit, offset } = normalizePlantFinderFilters(params);

  let builder = supabase
    .from("plant_catalog")
    .select(LIST_SELECT, { count: "exact" })
    .eq("publication_status", "published")
    .order("display_name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit);

  if (query) {
    const pattern = `%${escapeForOrFilter(query)}%`;
    builder = builder.or(`display_name.ilike.${pattern},common_name.ilike.${pattern},cultivar_name.ilike.${pattern}`);
  }

  if (plantType) {
    builder = builder.eq("plant_type", plantType);
  }

  if (sun) {
    builder = builder.overlaps("sun", sun);
  }

  if (heightCategory) {
    const bounds = heightCategoryBounds(heightCategory);
    if (bounds.min !== null) builder = builder.gt("height_max_cm", bounds.min);
    if (bounds.max !== null) builder = builder.lte("height_max_cm", bounds.max);
  }

  const { data, error, count } = await builder;
  if (error) throw error;

  const rows = data || [];
  const hasMore = rows.length > limit;
  return { plants: rows.slice(0, limit).map(rowToPlant), hasMore, total: count ?? 0 };
}

// fetchPublishedPlantBySlug(slug) -> Plant | null
// null means "no published plant at this slug" — indistinguishable, by
// design, from "a draft plant exists at this slug" (spec §9: a draft is
// never revealed to exist).
export async function fetchPublishedPlantBySlug(slug) {
  if (!slug) return null;

  const { data, error } = await supabase
    .from("plant_catalog")
    .select(LIST_SELECT)
    .eq("publication_status", "published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPlant(data) : null;
}
