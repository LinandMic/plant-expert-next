// Vocabulary duplicated from lib/plantFinderFormat.js (the Finder's own
// whitelists), never imported — scripts/plant-ingestion has no existing
// cross-import from lib/ anywhere in this repo, and this file keeps that
// boundary. Keep these two lists in sync by hand if the Finder's own
// vocabulary ever changes.

// lib/plantFinderFormat.js SUN_VALUES — identical to the real DB CHECK
// constraint (plant_catalog_sun_check in supabase/migrations/
// 20260823124800_create_plant_finder_catalog_v1.sql).
export const SUN_VALUES = ["full_sun", "partial_sun", "bright_shade", "shade"];

// lib/plantFinderFormat.js PLANT_TYPE_VALUES — application-level whitelist
// only: plant_catalog.plant_type has NO CHECK constraint in the real DB, so
// this list is the only vocabulary boundary that exists for it anywhere.
export const PLANT_TYPE_VALUES = [
  "tree", "shrub", "perennial", "annual", "biennial",
  "grass", "climber", "groundcover", "fern", "bulb",
];

// TRAIT_KINDS describes, for every trait an editorial observation may ever
// target, how its normalized_value must be shaped. Only the 13
// PROMOTABLE_CATALOG_COLUMNS traits ever appear here — "soil" and anything
// else is rejected in validateEditorialInput.js before this map is even
// consulted. growth_form and water_need have no DB CHECK and no existing
// app-level whitelist anywhere in this codebase (confirmed: growth_form is
// not rendered by any Finder UI code today) — a vocabulary is never
// invented here for them, only a non-empty-string shape is enforced.
export const TRAIT_KINDS = {
  plant_type: { kind: "enum", values: PLANT_TYPE_VALUES },
  growth_form: { kind: "string" },
  height_min_cm: { kind: "number", min: 0 },
  height_max_cm: { kind: "number", min: 0 },
  spread_max_cm: { kind: "number", min: 0 },
  sun: { kind: "enum_array", values: SUN_VALUES },
  hardiness_min_rank: { kind: "integer" },
  hardiness_max_rank: { kind: "integer" },
  evergreen: { kind: "boolean" },
  water_need: { kind: "string" },
  container_suitable: { kind: "boolean" },
  edible: { kind: "boolean" },
  flowering_months: { kind: "int_array", min: 1, max: 12 },
};
