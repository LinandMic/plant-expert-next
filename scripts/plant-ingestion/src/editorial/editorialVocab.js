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

// WATER_NEED_VALUES — application-level whitelist only, same status as
// PLANT_TYPE_VALUES: plant_catalog.water_need has NO CHECK constraint in the
// real DB (text, nullable), so this list is the only vocabulary boundary
// that exists for it anywhere. Locked by explicit product decision (no live
// plant_catalog row had a non-null water_need value before this decision —
// this is ALMEO's first real convention for the field, not a retrofit).
//
// Semantics (product decision, not inferred from any single source):
// water_need represents the ROUTINE water requirement of an ESTABLISHED
// plant growing under otherwise suitable conditions — a coarse product
// category, never an irrigation frequency. Establishment-phase watering
// (e.g. "water weekly for the first season") is deliberately NOT encoded
// here even when a source describes it — that nuance belongs in the
// editorial observation's source evidence / review note, never in the
// canonical value itself, so a temporary establishment routine can never
// be mistaken for this species' long-term character.
//
// Mapping principle for curators: source concepts such as "low"/"minimum"/
// "drought-tolerant once established" may map to `low` when the evidence
// supports a routine low water need; "average"/"moderate" may map to
// `moderate`; "high"/"consistently moist"/high routine demand may map to
// `high`. Never force a mapping the evidence doesn't support — leave the
// value unwritten instead.
export const WATER_NEED_VALUES = ["low", "moderate", "high"];

// TRAIT_KINDS describes, for every trait an editorial observation may ever
// target, how its normalized_value must be shaped. Only the 13
// PROMOTABLE_CATALOG_COLUMNS traits ever appear here — "soil" and anything
// else is rejected in validateEditorialInput.js before this map is even
// consulted. growth_form has no DB CHECK and no existing app-level
// whitelist anywhere in this codebase (confirmed: not rendered by any
// Finder UI code today) — a vocabulary is never invented here for it, only
// a non-empty-string shape is enforced. water_need previously had the same
// treatment; it now has a locked whitelist (WATER_NEED_VALUES above) per
// explicit product decision, enforced the same way plant_type/sun already
// are — see validateValueShape()'s existing "enum" branch, which needed no
// change to start enforcing this.
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
  water_need: { kind: "enum", values: WATER_NEED_VALUES },
  container_suitable: { kind: "boolean" },
  edible: { kind: "boolean" },
  flowering_months: { kind: "int_array", min: 1, max: 12 },
};
