// Display helpers for My Garden's plant list/card (pages/index.js's
// MonJardinTab). Extracted into lib/ (rather than kept as page-local
// functions) so the real-device bug this round fixed — a catalog-sourced
// garden plant (source='catalog') rendering with no name/scientific
// name/type, because the card only ever read ai_data.identite.* — has real
// regression coverage (see gardenPlantDisplay.test.js), matching this
// codebase's existing convention of pure display logic living in lib/
// (e.g. lib/plantFinderFormat.js).
//
// A garden plant added from the AI-identification flow always has its
// name/latin name/category inside ai_data.identite.* — that shape wins
// first in every helper below, so those plants render byte-for-byte as
// before. A garden plant added from Plant Finder (source='catalog', see
// components/AddToGardenModal.js + lib/gardenApi.js's insertCatalogPlant)
// has ai_data={} instead: no identite at all. Its display instead comes
// from the plant's own commonName/latinName/category (snapshotted at
// add-time by useGarden's rowToLocalPlant) or, preferably, from a LIVE
// locale-aware lookup (preferredCommonNameFr/En, catalogPlantType) that
// lib/gardenApi.js's fetchGardenRows resolves in two batched queries
// alongside the garden list itself — never one query per plant, and never
// a new snapshot duplicating catalog/taxon reference data unnecessarily.
import { plantTypeLabel, GARDEN_USE_VALUES } from "./plantFinderFormat.js";

export function gardenPlantDisplayName(p, locale) {
  const aiName = p && p.data && p.data.identite && p.data.identite.nom_commun;
  if (aiName) return aiName;
  if (!p) return null;
  const catalogName = locale === "en" ? p.preferredCommonNameEn : p.preferredCommonNameFr;
  return catalogName || p.commonName || null;
}

export function gardenPlantLatinName(p) {
  const aiLatin = p && p.data && p.data.identite && p.data.identite.nom_latin;
  if (aiLatin) return aiLatin;
  return (p && p.latinName) || null;
}

// t is only needed for the plant_type fallback (translating the catalog's
// raw DB value, e.g. "shrub" -> "Arbuste"/"Shrub", the same label Plant
// Finder itself uses via plantTypeLabel) — never stored/snapshotted, so
// switching locale relabels it immediately, same as the name above.
export function gardenPlantCategory(p, t) {
  const aiCategory = p && p.data && p.data.identite && p.data.identite.categorie;
  if (aiCategory) return aiCategory;
  if (!p) return null;
  return plantTypeLabel(p.catalogPlantType, t) || p.category || null;
}

// My Garden's category filter chips, as stable keys (labels come from
// garden.category.<key>), in display order. vegetable/fruit/herb/rose are
// the same values as plant_catalog.garden_uses.
export const GARDEN_CATEGORY_KEYS = ["tree", "shrub", "perennial", "annual", "herb", "vegetable", "fruit", "rose", "other"];

// The AI identification prompt's French categorie enum (pages/index.js) ->
// chip key. These labels are what the AI writes into ai_data, so they stay
// French whatever the UI locale.
const AI_CATEGORY_KEYS = {
  "Arbre": "tree",
  "Arbuste": "shrub",
  "Plante vivace": "perennial",
  "Annuelle": "annual",
  "Aromate": "herb",
  "Légume": "vegetable",
  "Fruit": "fruit",
  "Rosier": "rose",
  "Autre": "other",
};

// plant_catalog.plant_type -> chip key, for the types that have no chip of
// their own (product decision).
const PLANT_TYPE_CATEGORY_KEYS = {
  tree: "tree",
  shrub: "shrub",
  perennial: "perennial",
  grass: "perennial",
  fern: "perennial",
  groundcover: "perennial",
  bulb: "perennial",
  annual: "annual",
  biennial: "annual",
  climber: "other",
};

// gardenPlantCategoryKeys(p) -> string[] of GARDEN_CATEGORY_KEYS
// Every chip a garden plant appears under. An AI-identified plant has
// exactly one (its AI categorie). A catalog plant has its plant_type's key
// PLUS every one of its garden uses — a tomato is both "annual" and
// "vegetable". A plant nothing can be derived for falls under "other".
export function gardenPlantCategoryKeys(p) {
  if (!p) return [];
  const aiCategory = p.data && p.data.identite && p.data.identite.categorie;
  if (aiCategory) return [AI_CATEGORY_KEYS[aiCategory] || "other"];

  const keys = [];
  const typeKey = PLANT_TYPE_CATEGORY_KEYS[p.catalogPlantType];
  if (typeKey) keys.push(typeKey);
  for (const use of Array.isArray(p.catalogGardenUses) ? p.catalogGardenUses : []) {
    if (GARDEN_USE_VALUES.includes(use) && !keys.includes(use)) keys.push(use);
  }
  if (keys.length > 0) return keys;
  return [AI_CATEGORY_KEYS[p.category] || "other"];
}
