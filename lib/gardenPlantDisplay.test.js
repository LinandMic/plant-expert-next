import { test } from "node:test";
import assert from "node:assert/strict";

import { gardenPlantDisplayName, gardenPlantLatinName, gardenPlantCategory } from "./gardenPlantDisplay.js";
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
