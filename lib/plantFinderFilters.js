// Pure filter-state helpers for the Plant Finder V1 filters (plant_type,
// sun, adult height). Nothing here touches Supabase or the DOM — these
// functions only decide what a "valid" filter value is, how filter state
// maps to/from the URL, and how the UI state transitions (remove one chip,
// reset, clear all) happen. Any value not on a whitelist is dropped, never
// forwarded raw to a query builder or the URL.

import { PLANT_TYPE_VALUES, SUN_VALUES, HEIGHT_CATEGORY_VALUES } from "./plantFinderFormat.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

// Adult-height category -> plant_catalog.height_max_cm bounds (spec: Petit
// <=100, Moyen >100 et <=300, Grand >300 et <=600, Très grand >600). `min`
// is an exclusive lower bound, `max` an inclusive upper bound; null means
// "no bound on that side". A row with height_max_cm=null never satisfies a
// gt/lte comparison in Postgres, so it is naturally excluded once any
// height filter is active — no special-casing needed.
const HEIGHT_CATEGORY_BOUNDS = {
  small: { min: null, max: 100 },
  medium: { min: 100, max: 300 },
  large: { min: 300, max: 600 },
  very_large: { min: 600, max: null },
};

// heightCategoryBounds(category) -> { min, max } | null
export function heightCategoryBounds(category) {
  return HEIGHT_CATEGORY_BOUNDS[category] || null;
}

function normalizeSunValues(sun) {
  if (!Array.isArray(sun)) return null;
  const valid = sun.filter((v) => SUN_VALUES.includes(v));
  return valid.length > 0 ? valid : null;
}

// normalizePlantFinderFilters(input) -> { query, plantType, sun, heightCategory, limit }
// The single choke point every filter value must pass through before it
// can reach a Supabase query builder or be written to the URL. An unknown
// plant_type/sun/height value is silently dropped (never thrown, never
// passed through raw) — this is what keeps an unexpected/tampered query
// param from ever becoming raw PostgREST input.
export function normalizePlantFinderFilters(input = {}) {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const plantType = PLANT_TYPE_VALUES.includes(input.plantType) ? input.plantType : null;
  const sun = normalizeSunValues(input.sun);
  const heightCategory = HEIGHT_CATEGORY_VALUES.includes(input.heightCategory) ? input.heightCategory : null;

  const rawLimit = Number.isFinite(input.limit) ? Math.floor(input.limit) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);

  return { query, plantType, sun, heightCategory, limit };
}

// parseFiltersFromQuery(routerQuery) -> normalized filters
// Reads the raw (string-only) URL query params (`q`, `type`, `sun`,
// `height`) and runs them through the same whitelist as every other
// caller. `sun` is comma-separated in the URL (spec: "sun=full_sun,partial_sun").
export function parseFiltersFromQuery(routerQuery = {}) {
  const sun =
    typeof routerQuery.sun === "string"
      ? routerQuery.sun
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : null;

  return normalizePlantFinderFilters({
    query: typeof routerQuery.q === "string" ? routerQuery.q : "",
    plantType: typeof routerQuery.type === "string" ? routerQuery.type : null,
    sun,
    heightCategory: typeof routerQuery.height === "string" ? routerQuery.height : null,
  });
}

// serializeFiltersToQuery(filters) -> { q?, type?, sun?, height? }
// Only includes keys for active criteria, so an all-clear state produces a
// clean/empty query object rather than a URL full of empty params.
export function serializeFiltersToQuery(filters = {}) {
  const result = {};
  if (filters.query) result.q = filters.query;
  if (filters.plantType) result.type = filters.plantType;
  if (Array.isArray(filters.sun) && filters.sun.length > 0) result.sun = filters.sun.join(",");
  if (filters.heightCategory) result.height = filters.heightCategory;
  return result;
}

// formatResultCount(count) -> "1 plante trouvée" | "N plantes trouvées"
export function formatResultCount(count) {
  return count === 1 ? "1 plante trouvée" : `${count} plantes trouvées`;
}

// removeActiveFilter(filters, key, value) -> next filters
// Removes exactly one active-filter chip's criterion, leaving every other
// criterion (including `query` and the rest of a multi-select `sun`)
// untouched.
export function removeActiveFilter(filters, key, value) {
  if (key === "plantType") return { ...filters, plantType: null };
  if (key === "height") return { ...filters, heightCategory: null };
  if (key === "sun") {
    const next = (filters.sun || []).filter((v) => v !== value);
    return { ...filters, sun: next.length > 0 ? next : null };
  }
  return filters;
}

// resetFilters(filters) -> clears plantType/sun/heightCategory, keeps query.
export function resetFilters(filters) {
  return { ...filters, plantType: null, sun: null, heightCategory: null };
}

// clearAllFilters() -> clears everything, including the text search.
export function clearAllFilters() {
  return { query: "", plantType: null, sun: null, heightCategory: null };
}
