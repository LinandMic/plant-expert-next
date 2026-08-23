import { supabase } from "./supabaseClient";

// Read-only access to the public Plant Finder catalog. Uses the SAME
// browser/anon Supabase client as the rest of the app — no service_role,
// no separate admin path. RLS (plant_catalog_published_select) already
// restricts anon/authenticated to publication_status='published' rows; the
// explicit .eq("publication_status", "published") below is defense in
// depth, never a substitute for RLS, and it means a draft row is never
// reachable through this API even if RLS were ever misconfigured.
const RESULT_LIMIT = 20;

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
  "plant_taxa ( canonical_name, family, genus )",
].join(", ");

function rowToPlant(row) {
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

// searchPublishedPlants(query) -> Plant[]
// No query text: first RESULT_LIMIT published plants, alphabetical by
// display_name. With query text: filtered server-side (display_name,
// common_name, cultivar_name — case-insensitive), same limit. Never
// fetches more than RESULT_LIMIT rows into the browser.
export async function searchPublishedPlants(query) {
  const trimmed = (query || "").trim();

  let builder = supabase
    .from("plant_catalog")
    .select(LIST_SELECT)
    .eq("publication_status", "published")
    .order("display_name", { ascending: true })
    .limit(RESULT_LIMIT);

  if (trimmed) {
    const pattern = `%${escapeForOrFilter(trimmed)}%`;
    builder = builder.or(`display_name.ilike.${pattern},common_name.ilike.${pattern},cultivar_name.ilike.${pattern}`);
  }

  const { data, error } = await builder;
  if (error) throw error;
  return (data || []).map(rowToPlant);
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
