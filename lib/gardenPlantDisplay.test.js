import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gardenPlantDisplayName,
  gardenPlantLatinName,
  gardenPlantCategory,
  gardenPlantCategoryKeys,
  GARDEN_CATEGORY_KEYS,
} from "./gardenPlantDisplay.js";
import { createTranslator } from "./i18n/core.js";

const t = createTranslator("fr");

// ---------------------------------------------------------------------------
// Real-device regression: a catalog-sourced garden plant (source='catalog')
// rendered with no name/scientific name/type because My Garden's card only
// ever read ai_data.identite.* — the live audit found the row's own
// commonName/latinName/preferredCommonName*/catalogPlantType were being
// completely ignored. These tests cover both plant "shapes" this app's
// garden can contain: ai_identification (data.identite.*) and catalog
// (commonName/latinName/preferredCommonName*/catalogPlantType).

function aiPlant(overrides = {}) {
  return {
    data: { identite: { nom_commun: "Hortensia", nom_latin: "Hydrangea macrophylla", categorie: "Arbuste" } },
    commonName: null,
    latinName: null,
    category: null,
    preferredCommonNameFr: null,
    preferredCommonNameEn: null,
    catalogPlantType: null,
    ...overrides,
  };
}

function catalogPlant(overrides = {}) {
  return {
    data: {},
    commonName: "Lavande officinale",
    latinName: "Lavandula angustifolia",
    category: null,
    preferredCommonNameFr: "Lavande officinale",
    preferredCommonNameEn: "English lavender",
    catalogPlantType: "shrub",
    ...overrides,
  };
}

test("gardenPlantDisplayName: ai_identification plant reads from data.identite, unaffected by this round", () => {
  assert.equal(gardenPlantDisplayName(aiPlant(), "fr"), "Hortensia");
});

test("gardenPlantDisplayName: catalog plant (no data.identite) falls back to the live preferred name for the active locale, fr", () => {
  assert.equal(gardenPlantDisplayName(catalogPlant(), "fr"), "Lavande officinale");
});

test("gardenPlantDisplayName: catalog plant, en locale, switches to the English preferred name — no frozen fr snapshot leaking into en", () => {
  assert.equal(gardenPlantDisplayName(catalogPlant(), "en"), "English lavender");
});

test("gardenPlantDisplayName: catalog plant with no live preferred name (e.g. taxon link lost) falls back to the commonName snapshot, never blank", () => {
  const p = catalogPlant({ preferredCommonNameFr: null, preferredCommonNameEn: null });
  assert.equal(gardenPlantDisplayName(p, "fr"), "Lavande officinale");
});

test("gardenPlantDisplayName: nothing available at all -> null, never a fabricated placeholder", () => {
  const p = catalogPlant({ commonName: null, preferredCommonNameFr: null, preferredCommonNameEn: null });
  assert.equal(gardenPlantDisplayName(p, "fr"), null);
});

test("gardenPlantDisplayName: tolerates a missing plant object without throwing", () => {
  assert.equal(gardenPlantDisplayName(undefined, "fr"), null);
});

test("gardenPlantLatinName: ai_identification plant reads from data.identite, unaffected", () => {
  assert.equal(gardenPlantLatinName(aiPlant()), "Hydrangea macrophylla");
});

test("gardenPlantLatinName: catalog plant falls back to the latinName snapshot (scientific names don't change per locale, no live lookup needed)", () => {
  assert.equal(gardenPlantLatinName(catalogPlant()), "Lavandula angustifolia");
});

test("gardenPlantLatinName: nothing available -> null", () => {
  assert.equal(gardenPlantLatinName(catalogPlant({ latinName: null })), null);
});

test("gardenPlantCategory: ai_identification plant reads from data.identite, unaffected", () => {
  assert.equal(gardenPlantCategory(aiPlant(), t), "Arbuste");
});

test("gardenPlantCategory: catalog plant derives a live, translated label from catalogPlantType — never snapshotted", () => {
  assert.equal(gardenPlantCategory(catalogPlant(), t), "Arbuste");
});

test("gardenPlantCategory: catalog plant, en locale, same catalogPlantType relabels immediately (no frozen fr text)", () => {
  const en = createTranslator("en");
  assert.equal(gardenPlantCategory(catalogPlant(), en), "Shrub");
});

test("gardenPlantCategory: no plant_type known -> null, never a fabricated category (category snapshot is legacy-only and always null for catalog rows today)", () => {
  const p = catalogPlant({ catalogPlantType: null });
  assert.equal(gardenPlantCategory(p, t), null);
});

// ---------------------------------------------------------------------------
// gardenPlantCategoryKeys — My Garden's category chips filter on stable
// keys, never on translated text: a catalog perennial used to be labelled
// "Vivace" and never matched the "Plante vivace" chip.

test("gardenPlantCategoryKeys: a catalog perennial matches the perennial chip (the old Vivace != Plante vivace mismatch)", () => {
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: "perennial" })), ["perennial"]);
});

test("gardenPlantCategoryKeys: plant types without a chip of their own map to the decided chip", () => {
  const cases = {
    grass: "perennial",
    fern: "perennial",
    groundcover: "perennial",
    bulb: "perennial",
    annual: "annual",
    biennial: "annual",
    climber: "other",
    tree: "tree",
    shrub: "shrub",
  };
  for (const [plantType, key] of Object.entries(cases)) {
    assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: plantType })), [key], plantType);
  }
});

test("gardenPlantCategoryKeys: a catalog plant appears under its botanical type AND every garden use", () => {
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: "annual", catalogGardenUses: ["vegetable"] })), ["annual", "vegetable"]);
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: "climber", catalogGardenUses: ["fruit"] })), ["other", "fruit"]);
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: "shrub", catalogGardenUses: ["rose"] })), ["shrub", "rose"]);
});

test("gardenPlantCategoryKeys: an unknown garden use value is ignored, never turned into a chip", () => {
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: "shrub", catalogGardenUses: ["ornamental"] })), ["shrub"]);
});

test("gardenPlantCategoryKeys: an AI-identified plant keeps its single AI category, whatever the catalog fields say", () => {
  assert.deepEqual(gardenPlantCategoryKeys(aiPlant()), ["shrub"]);
  const tomato = aiPlant({ data: { identite: { categorie: "Légume" } }, catalogPlantType: "annual" });
  assert.deepEqual(gardenPlantCategoryKeys(tomato), ["vegetable"]);
  assert.deepEqual(gardenPlantCategoryKeys(aiPlant({ data: { identite: { categorie: "Plante vivace" } } })), ["perennial"]);
  assert.deepEqual(gardenPlantCategoryKeys(aiPlant({ data: { identite: { categorie: "Champignon" } } })), ["other"]);
});

test("gardenPlantCategoryKeys: nothing derivable -> other; missing plant -> no chip at all", () => {
  assert.deepEqual(gardenPlantCategoryKeys(catalogPlant({ catalogPlantType: null })), ["other"]);
  assert.deepEqual(gardenPlantCategoryKeys(undefined), []);
});

test("GARDEN_CATEGORY_KEYS: every chip has a label in both locales", () => {
  const en = createTranslator("en");
  for (const key of GARDEN_CATEGORY_KEYS) {
    for (const tr of [t, en]) {
      const label = tr(`garden.category.${key}`);
      assert.ok(label && label !== `garden.category.${key}`, `${key} has no label`);
    }
  }
  assert.equal(t("garden.category.perennial"), "Plante vivace");
});
