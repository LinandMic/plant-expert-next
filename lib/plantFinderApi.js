import { supabase } from "./supabaseClient.js";
import { normalizePlantFinderFilters, heightCategoryBounds } from "./plantFinderFilters.js";

// Read-only access to the public Plant Finder catalog. Uses the SAME
// browser/anon Supabase client as the rest of the app — no service_role,
// no separate admin path. RLS (plant_catalog_published_select) already
// restricts anon/authenticated to publication_status='published' rows; the
// explicit publication_status filtering below (client-side .eq for
// fetchPublishedPlantBySlug, server-side in the search_published_plants
// RPC — see supabase/migrations/20260911090000_add_plant_finder_search_rpc.sql)
// is defense in depth, never a substitute for RLS, and it means a draft
// row is never reachable through this API even if RLS were ever
// misconfigured.

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

// Shared field mapping between the two row shapes this module deals with:
// a plain plant_catalog select with an embedded plant_taxa resource (used
// by fetchPublishedPlantBySlug, and by rowToPlant's own tests), and the
// flat per-row shape returned by the search_published_plants RPC (used by
// searchPublishedPlants) — same columns, taxon fields just aren't nested
// under a `plant_taxa` key there. `taxon` is passed in already normalized
// so both callers share every other field's mapping verbatim.
function baseRowToPlant(row, taxon) {
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
    taxon,
  };
}

export function rowToPlant(row) {
  return baseRowToPlant(
    row,
    row.plant_taxa
      ? {
          canonicalName: row.plant_taxa.canonical_name,
          family: row.plant_taxa.family,
          genus: row.plant_taxa.genus,
        }
      : null
  );
}

// rpcRowToPlant(row) — same as rowToPlant, but for a row coming back from
// the search_published_plants RPC, whose taxon columns (canonical_name,
// family, genus) are flat on the row rather than nested under plant_taxa.
// Every plant_catalog row has a taxon_id (not-null FK) and the RPC always
// joins plant_taxa, so canonical_name is never itself the signal of
// "no taxon" the way the embedded-resource null check is above — it can
// only be legitimately empty if the RPC's own SELECT list changes.
function rpcRowToPlant(row) {
  return baseRowToPlant(row, {
    canonicalName: row.canonical_name ?? null,
    family: row.family ?? null,
    genus: row.genus ?? null,
  });
}

// searchPublishedPlants({ query, plantType, sun, heightCategory, limit, offset })
//   -> { plants: Plant[], hasMore: boolean, total: number }
// Every filter value is run through normalizePlantFinderFilters() first —
// this function never trusts its caller to have already sanitized input,
// so an unknown/tampered plantType, sun, heightCategory, limit, or offset
// can never reach the RPC. Delegates the actual matching to the
// search_published_plants Postgres function (see
// supabase/migrations/20260911090000_add_plant_finder_search_rpc.sql):
// case- and accent-insensitive, matches display_name/common_name/
// cultivar_name on the row itself OR any plant_taxon_names entry
// (accepted name or synonym) for the same taxon — a scientific synonym
// search plain client-side filtering never had. Alphabetical by
// display_name (with `id` as a stable tie-break — two rows can share the
// exact same display_name, and without a second, unique sort key their
// relative order across separate pages would be arbitrary, risking a
// skipped or duplicated row on "Charger plus") is enforced inside the RPC
// itself. Sun uses OR/overlap semantics (a plant matches if it has at
// least one selected exposure); a plant with sun=null never matches an
// active exposition filter. Height filtering is done on height_max_cm only
// (never height_min_cm); a null height_max_cm never matches an active
// height filter — both preserved exactly as before, just evaluated inside
// the RPC's SQL now instead of PostgREST's query builder.
//
// One round trip: the RPC returns { total, rows } together — `total` is
// computed over the FULL matching set before pagination is applied (never
// just the page's row count), so it stays correct even when `offset` lands
// past the last row (an empty page). hasMore is then derived from
// offset + rows.length < total — no second "fetch one extra row" request
// needed the way a plain range() query required.
//
// buildSearchRpcParams(normalizedFilters) -> the exact named-argument
// object passed to the search_published_plants RPC. Exported as its own
// pure function (no Supabase client involved) so it — and therefore
// "did the right filters actually get sent" — is unit-testable without a
// live network call; see lib/plantFinderApi.test.js.
export function buildSearchRpcParams({ query, plantType, sun, heightCategory, limit, offset }) {
  const bounds = heightCategory ? heightCategoryBounds(heightCategory) : null;
  return {
    search_query: query || null,
    plant_type_filter: plantType || null,
    sun_filter: sun || null,
    height_min: bounds ? bounds.min : null,
    height_max: bounds ? bounds.max : null,
    result_limit: limit,
    result_offset: offset,
  };
}

// `client` defaults to the real singleton but is injectable so tests can
// pass a fake `{ rpc }` and assert on both the outgoing call (right RPC
// name, right params — i.e. that every filter really does reach the
// server-side search) and the response mapping (rows/hasMore/total), all
// without touching the network. The actual matching/accent-folding/
// published-only SQL logic lives in and is verified against the
// search_published_plants function itself (see the migration + the round's
// live-Supabase audit), which no amount of client-side mocking can stand
// in for.
export async function searchPublishedPlants(params, client = supabase) {
  const normalized = normalizePlantFinderFilters(params);
  const { offset } = normalized;

  const { data, error } = await client.rpc("search_published_plants", buildSearchRpcParams(normalized));
  if (error) throw error;

  const rows = (data && data.rows) || [];
  const total = (data && data.total) || 0;
  const hasMore = offset + rows.length < total;
  return { plants: rows.map(rpcRowToPlant), hasMore, total };
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
