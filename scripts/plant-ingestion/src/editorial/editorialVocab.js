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
// Format version for editorial curation inputs. Bumped to 2 by the
// provenance model migration (schema_version 1 = no `curation` object, a
// single conflated `source.license` implicitly read as the source's own
// license — see validateEditorialInput.js). A v1 input is REJECTED, never
// silently reinterpreted: an old input's `source.license` must never be
// guessed into `curation.license`, that is exactly the conflation this
// migration exists to prevent.
export const EDITORIAL_SCHEMA_VERSION = 2;

// Full DB-level vocabulary for plant_trait_observations.curation_method
// (matches the real CHECK constraint,
// plant_trait_observations_curation_method_check, added by
// supabase/migrations/20260902100000_add_editorial_provenance_v1.sql).
export const CURATION_METHODS_SCHEMA = ["expert_knowledge", "open_source_synthesis", "restricted_source_paraphrase"];

// Product-level allowlist: what the editorial CLI/validator accepts TODAY.
// "restricted_source_paraphrase" is deliberately schema-ready (the DB
// already accepts it) but NOT product-enabled — a curation input naming it
// is rejected explicitly (CURATION_METHOD_NOT_ENABLED), never silently
// downgraded to another method and never silently accepted.
export const CURATION_METHODS_ENABLED = ["expert_knowledge", "open_source_synthesis"];

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
