// Pure, centralized plant_catalog quality/completeness logic. Deliberately
// separate from `publication_status` (a curator-owned publish workflow) —
// this module NEVER reads or writes publication_status, and its result is
// an aide à décision, never an automatic trigger to publish anything. See
// scripts/plant-ingestion/README.md's "quality_status vs publication_status"
// section for the full distinction.
//
// Lives in lib/ (not scripts/plant-ingestion/) so a single implementation
// is reusable everywhere this repo might eventually need it: the ingestion
// pipeline, a future curator backoffice, and — eventually, deliberately not
// yet — the public UI. Zero React/Next/Supabase import: safe to call from
// a Node CLI, a server-rendered page, or a browser bundle alike.
//
// Nothing here is stored in the DB (spec: "Ne pas ajouter de colonne DB —
// le statut doit être CALCULÉ à partir des données existantes"). Every
// value below is derived fresh from a plant_catalog-shaped object each call.

// isPresent(value) -> boolean
// "Renseigné" vs "absent", per spec §4: null/undefined/""/[]/{} (empty
// object) count as absent. false and 0 are real, informative values and
// must NEVER be treated as absent — a plant that is genuinely not
// evergreen (false) or has a genuinely 0 something is still DATA, not a
// gap. Mirrors scripts/plant-ingestion/src/informative.js's isInformative()
// rule exactly (duplicated rather than imported: lib/ has no existing
// cross-import from scripts/plant-ingestion, see editorialVocab.js for the
// same pattern), extended with the empty-plain-object case this spec asks
// for explicitly (unused by any of the 7 tracked blocks today, kept for
// robustness/fidelity to spec rather than because a current field needs it).
export function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// The 4 CRITICAL blocks (spec §2) — height_min_cm/height_max_cm count as
// ONE block ("height"), never two, so CRITICAL total is 4, not 5.
export const CRITICAL_BLOCKS = ["plant_type", "sun", "height", "spread"];

// The 3 IMPORTANT blocks counted in this v1 score. container_suitable and
// edible are deliberately excluded (spec §3: "ne pas les rendre
// obligatoires... car ils ne sont pas universellement pertinents") — they
// remain real, useful Field-displayed traits (see lib/plantFinderFormat.js),
// just not part of this completeness score. growth_form and hardiness_*
// are excluded too: confirmed elsewhere in this codebase to have zero
// effect on any Finder UI today (dead columns), so scoring them would
// reward filling in something nobody can see yet.
export const IMPORTANT_BLOCKS = ["evergreen", "water_need", "flowering_months"];

const TOTAL_BLOCKS = CRITICAL_BLOCKS.length + IMPORTANT_BLOCKS.length; // 7

// blockPresence(entry) -> { plant_type, sun, height, spread, evergreen, water_need, flowering_months }
// `entry` is a plant_catalog-row-shaped object (real DB column names,
// snake_case) — the least-transformed representation, so the ingestion
// pipeline (which already works in this shape everywhere, e.g. catalog.js/
// compileSelections.js) never needs a mapping layer, and a future
// backoffice/UI caller can pass a raw Supabase row directly.
function blockPresence(entry) {
  const e = entry || {};
  return {
    plant_type: isPresent(e.plant_type),
    sun: isPresent(e.sun),
    // "height_min_cm + height_max_cm comptent comme un même bloc" — either
    // one being informative is enough for the block to count as present.
    height: isPresent(e.height_min_cm) || isPresent(e.height_max_cm),
    spread: isPresent(e.spread_max_cm),
    evergreen: isPresent(e.evergreen),
    water_need: isPresent(e.water_need),
    flowering_months: isPresent(e.flowering_months),
  };
}

// computePlantCompleteness(entry, { taxonomyResolved }) -> report
//
// `taxonomyResolved` defaults to `true` deliberately: for a REAL, EXISTING
// plant_catalog row, taxonomy is already guaranteed resolved by the schema
// itself — plant_taxa.taxonomic_status has a CHECK constraint allowing only
// 'accepted' (supabase/migrations/20260823124800_create_plant_finder_catalog_v1.sql),
// and Layer B's own compiler (scripts/plant-ingestion/src/plan/validate.js,
// TAXONOMY_UNRESOLVED/TAXONOMY_NOT_ACCEPTED) already refuses to compile a
// plan entry whose taxonomy isn't resolved+accepted — a catalog row simply
// cannot come to exist otherwise. So this function never needs to inspect
// taxonomy data for the common case (spec §5: "ne pas inventer un nouveau
// statut si l'information existe déjà" — the information already exists,
// structurally, as "this catalog row exists at all").
//
// The explicit override exists for the one real case where it matters: a
// CANDIDATE that never became a catalog row (e.g. a cultivar WCVP resolves
// as not_found) — a caller reasoning about such a candidate (never a UI
// component; this module has zero DB/UI coupling of its own) passes
// `{ taxonomyResolved: false }` explicitly. Never inferred, never guessed.
export function computePlantCompleteness(entry, { taxonomyResolved = true } = {}) {
  const blocks = blockPresence(entry);

  const criticalMissing = CRITICAL_BLOCKS.filter((b) => !blocks[b]);
  const importantMissing = IMPORTANT_BLOCKS.filter((b) => !blocks[b]);
  const criticalCompleted = CRITICAL_BLOCKS.length - criticalMissing.length;
  const importantCompleted = IMPORTANT_BLOCKS.length - importantMissing.length;

  let quality_status;
  if (!taxonomyResolved || criticalCompleted === 0) {
    quality_status = "draft";
  } else if (criticalMissing.length === 0 && importantMissing.length === 0) {
    quality_status = "ready_complete";
  } else {
    quality_status = "ready_searchable";
  }

  return {
    quality_status,
    critical: { completed: criticalCompleted, total: CRITICAL_BLOCKS.length, missing: criticalMissing },
    important: { completed: importantCompleted, total: IMPORTANT_BLOCKS.length, missing: importantMissing },
    completeness_percent: Math.round(((criticalCompleted + importantCompleted) / TOTAL_BLOCKS) * 100),
  };
}
