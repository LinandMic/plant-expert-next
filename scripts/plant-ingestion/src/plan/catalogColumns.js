// The plant_catalog typed "hot-filter" columns that a trait_selection is
// ever allowed to promote into. Copied EXACTLY from
// supabase/migrations/20260823124800_create_plant_finder_catalog_v1.sql's
// plant_catalog table (plant_type, growth_form, height_min_cm,
// height_max_cm, spread_max_cm, sun, hardiness_min_rank,
// hardiness_max_rank, evergreen, water_need, container_suitable, edible,
// flowering_months) — never invented column names. A selection for any
// other trait is not a supported canonical catalog column — reject rather
// than silently drop it.
export const PROMOTABLE_CATALOG_COLUMNS = new Set([
  "plant_type",
  "growth_form",
  "height_min_cm",
  "height_max_cm",
  "spread_max_cm",
  "sun",
  "hardiness_min_rank",
  "hardiness_max_rank",
  "evergreen",
  "water_need",
  "container_suitable",
  "edible",
  "flowering_months",
]);
