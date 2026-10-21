import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeText,
  parseLength,
  parseSun,
  parsePlantType,
  parseEvergreen,
  parseWaterNeed,
  parseMonths,
  quoteContainsName,
} from "../../src/completion/textParsers.js";

// Wording shapes only (synthetic values) — no horticultural claim.

test("normalizeText folds accents, case, dashes and spaces", () => {
  assert.equal(normalizeText("  Hauteur  :  1–2 MÈTRES "), "hauteur : 1-2 metres");
});

test("parseLength: metres, feet, ft+in, ranges, French wording, open-ended, keyword slicing", () => {
  assert.deepEqual(parseLength("Ultimate height 1–1.5 metres", "height"), { min_cm: 100, max_cm: 150, open_ended: false });
  assert.deepEqual(parseLength("Height: 3.00 to 6.00 feet Spread: 2.00 to 4.00 feet", "height"), { min_cm: 91, max_cm: 183, open_ended: false });
  assert.deepEqual(parseLength("Height: 3.00 to 6.00 feet Spread: 2.00 to 4.00 feet", "spread"), { min_cm: 61, max_cm: 122, open_ended: false });
  assert.deepEqual(parseLength("Height: 6 ft. 0 in. - 12 ft. 0 in.", "height"), { min_cm: 183, max_cm: 366, open_ended: false });
  assert.deepEqual(parseLength("Hauteur : de 2 à 4 m", "height"), { min_cm: 200, max_cm: 400, open_ended: false });
  assert.deepEqual(parseLength("Hauteur à maturité : 60 cm", "height"), { min_cm: null, max_cm: 60, open_ended: false });
  assert.deepEqual(parseLength("Ultimate height Higher than 12 metres", "height"), { min_cm: 1200, max_cm: null, open_ended: true });
  assert.equal(parseLength("Height: medium", "height"), null);
});

test("parseSun maps EN/FR exposure wording to the vocabulary", () => {
  assert.deepEqual(parseSun("Full sun, Partial shade"), ["full_sun", "partial_sun"]);
  assert.deepEqual(parseSun("Sun: Full sun to part shade"), ["full_sun", "partial_sun"]);
  assert.deepEqual(parseSun("Exposition : mi-ombre à ombre"), ["partial_sun", "shade"]);
  assert.deepEqual(parseSun("dappled shade"), ["bright_shade"]);
  assert.equal(parseSun("Soil: clay"), null);
});

test("parsePlantType returns every stated type", () => {
  assert.deepEqual(parsePlantType("Type: Deciduous shrub"), ["shrub"]);
  assert.deepEqual(parsePlantType("Plant Type: Shrub, Tree"), ["tree", "shrub"]);
  assert.deepEqual(parsePlantType("Herbaceous perennial"), ["perennial"]);
  assert.deepEqual(parsePlantType("Plante grimpante"), ["climber"]);
  assert.equal(parsePlantType("Family: Rosaceae"), null);
});

test("parseEvergreen: true / false / null when ambiguous or absent", () => {
  assert.equal(parseEvergreen("Foliage: Evergreen"), true);
  assert.equal(parseEvergreen("Feuillage caduc"), false);
  assert.equal(parseEvergreen("Semi-evergreen"), null);
  assert.equal(parseEvergreen("evergreen or deciduous"), null);
  assert.equal(parseEvergreen("Hardy"), null);
});

test("parseWaterNeed: 'well-drained' alone says nothing; ranges give several values", () => {
  assert.deepEqual(parseWaterNeed("Water: Dry to medium"), ["low", "moderate"]);
  assert.deepEqual(parseWaterNeed("Moisture: Moist but well-drained, Well-drained"), ["moderate"]);
  assert.equal(parseWaterNeed("Well-drained"), null);
  assert.deepEqual(parseWaterNeed("Constantly moist soil"), ["high"]);
});

test("parseMonths: months, ranges (incl. wrap-around), seasons, French", () => {
  assert.deepEqual(parseMonths("Bloom Time: May to June"), [5, 6]);
  assert.deepEqual(parseMonths("Flowering season(s) Spring, Summer"), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(parseMonths("Floraison : avril à juin"), [4, 5, 6]);
  assert.deepEqual(parseMonths("late spring to early summer"), [5, 6]);
  assert.deepEqual(parseMonths("November to February"), [1, 2, 11, 12]);
  assert.equal(parseMonths("Hardiness: H5"), null);
});

test("quoteContainsName: whole-name match, punctuation and accents ignored", () => {
  assert.equal(quoteContainsName("Nom vernaculaire : Buis commun, Buis toujours vert", "Buis commun"), true);
  assert.equal(quoteContainsName("Noms : Érable champêtre", "erable champetre"), true);
  assert.equal(quoteContainsName("Nom : Buisson", "Buis"), false);
});

test("parseLength: open-ended spread wording ('wider than', as written by RHS) is a minimum, never a maximum", () => {
  assert.deepEqual(parseLength("Max Spread wider than 8 metres", "spread"), { min_cm: 800, max_cm: null, open_ended: true });
  assert.deepEqual(parseLength("wider than 8 metres", "spread"), { min_cm: 800, max_cm: null, open_ended: true });
  assert.deepEqual(parseLength("Max Height taller than 12 metres", "height"), { min_cm: 1200, max_cm: null, open_ended: true });
  assert.deepEqual(parseLength("Envergure : plus large que 3 m", "spread"), { min_cm: 300, max_cm: null, open_ended: true });
  assert.deepEqual(parseLength("Max Spread 4-8 metres", "spread"), { min_cm: 400, max_cm: 800, open_ended: false });
});
