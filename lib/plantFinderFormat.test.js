import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatHeightRange,
  sunLabels,
  entryTypeLabel,
  formatBoolean,
  formatFloweringMonths,
  formatFloweringSeason,
  formatPlantGlance,
  plantTypeLabel,
  plantFinderDisplayTitle,
} from "./plantFinderFormat.js";
import { createTranslator } from "./i18n/core.js";

// These label-lookup helpers take a translator as their last argument (i18n
// round 1) — tests exercise the French dictionary, the same labels this
// suite asserted before i18n existed.
const t = createTranslator("fr");

test("formatHeightRange: min=max in meters, rounded and comma-formatted (182.3cm -> 1,8 m)", () => {
  assert.equal(formatHeightRange(182.3, 182.3), "1,8 m");
});

test("formatHeightRange: a range in meters", () => {
  assert.equal(formatHeightRange(300, 500), "3–5 m");
});

test("formatHeightRange: values under 100cm use cm", () => {
  assert.equal(formatHeightRange(45, 45), "45 cm");
  assert.equal(formatHeightRange(20, 90), "20–90 cm");
});

test("formatHeightRange: never a raw unrounded decimal like 182,300000 cm", () => {
  const result = formatHeightRange(182.3, 182.3);
  assert.ok(!result.includes("."));
  assert.ok(!result.includes("cm"));
  assert.equal(result, "1,8 m");
});

test("formatHeightRange: whole-meter values show no decimal", () => {
  assert.equal(formatHeightRange(200, 200), "2 m");
});

test("formatHeightRange: only one bound known formats that value alone", () => {
  assert.equal(formatHeightRange(182.3, null), "1,8 m");
  assert.equal(formatHeightRange(null, 45), "45 cm");
});

test("formatHeightRange: both null -> null, never a fabricated value", () => {
  assert.equal(formatHeightRange(null, null), null);
  assert.equal(formatHeightRange(undefined, undefined), null);
});

test("sunLabels: maps the 4 canonical values to French", () => {
  assert.deepEqual(sunLabels(["full_sun"], t), ["Plein soleil"]);
  assert.deepEqual(sunLabels(["partial_sun"], t), ["Mi-ombre"]);
  assert.deepEqual(sunLabels(["bright_shade"], t), ["Ombre lumineuse"]);
  assert.deepEqual(sunLabels(["shade"], t), ["Ombre"]);
  assert.deepEqual(sunLabels(["full_sun", "partial_sun"], t), ["Plein soleil", "Mi-ombre"]);
});

test("sunLabels: null/empty never invents a value", () => {
  assert.equal(sunLabels(null, t), null);
  assert.equal(sunLabels(undefined, t), null);
  assert.equal(sunLabels([], t), null);
});

test("entryTypeLabel: species/cultivar/unknown", () => {
  assert.equal(entryTypeLabel("species", t), "Espèce");
  assert.equal(entryTypeLabel("cultivar", t), "Cultivar");
  assert.equal(entryTypeLabel("genus", t), null);
  assert.equal(entryTypeLabel(null, t), null);
});

test("formatBoolean: null handling — false/true are informative, null/undefined stay unknown", () => {
  assert.equal(formatBoolean(true, t), "Oui");
  assert.equal(formatBoolean(false, t), "Non");
  assert.equal(formatBoolean(null, t), null);
  assert.equal(formatBoolean(undefined, t), null);
});

test("formatFloweringMonths: sorts and labels in French, null when absent", () => {
  assert.equal(formatFloweringMonths([4, 5, 3], t), "Mars, Avril, Mai");
  assert.equal(formatFloweringMonths(null, t), null);
  assert.equal(formatFloweringMonths([], t), null);
});

test("plantTypeLabel: maps every documented DB value to its French label", () => {
  assert.equal(plantTypeLabel("tree", t), "Arbre");
  assert.equal(plantTypeLabel("shrub", t), "Arbuste");
  assert.equal(plantTypeLabel("perennial", t), "Vivace");
  assert.equal(plantTypeLabel("annual", t), "Annuelle");
  assert.equal(plantTypeLabel("biennial", t), "Bisannuelle");
  assert.equal(plantTypeLabel("grass", t), "Graminée");
  assert.equal(plantTypeLabel("climber", t), "Grimpante");
  assert.equal(plantTypeLabel("groundcover", t), "Couvre-sol");
  assert.equal(plantTypeLabel("fern", t), "Fougère");
  assert.equal(plantTypeLabel("bulb", t), "Bulbe");
});

test("plantTypeLabel: null/undefined stay null", () => {
  assert.equal(plantTypeLabel(null, t), null);
  assert.equal(plantTypeLabel(undefined, t), null);
});

test("plantTypeLabel: an unrecognized value is never guessed and never shown as the raw technical slug", () => {
  assert.equal(plantTypeLabel("liana", t), null);
  assert.notEqual(plantTypeLabel("liana", t), "liana");
});

// plantFinderDisplayTitle is locale-aware since the "display preferred
// common names by locale" round: the preferred vernacular name comes from
// plant_common_names (one row per taxon+locale, surfaced on the Plant shape
// as preferredCommonNameFr/preferredCommonNameEn — see
// lib/plantFinderApi.js), never from the old single-locale
// plant_catalog.common_name field (always null in practice; kept on the
// shape only for backward compatibility and never read here).

const LAVANDULA = {
  displayName: "Lavandula angustifolia",
  preferredCommonNameFr: "Lavande officinale",
  preferredCommonNameEn: "English lavender",
};

test("plantFinderDisplayTitle: fr locale — preferred FR common name leads, botanical name is the subtitle", () => {
  const result = plantFinderDisplayTitle(LAVANDULA, "fr");
  assert.equal(result.title, "Lavande officinale");
  assert.equal(result.scientificSubtitle, "Lavandula angustifolia");
});

test("plantFinderDisplayTitle: en locale — same plant, preferred EN common name leads instead", () => {
  const result = plantFinderDisplayTitle(LAVANDULA, "en");
  assert.equal(result.title, "English lavender");
  assert.equal(result.scientificSubtitle, "Lavandula angustifolia");
});

test("plantFinderDisplayTitle: locale switch fr -> en updates the title without any other input changing", () => {
  const fr = plantFinderDisplayTitle(LAVANDULA, "fr");
  const en = plantFinderDisplayTitle(LAVANDULA, "en");
  assert.notEqual(fr.title, en.title);
  assert.equal(fr.scientificSubtitle, en.scientificSubtitle);
});

test("plantFinderDisplayTitle: cultivar — taxon-level FR common name leads, 'Bloodgood' identity stays visible in the botanical subtitle", () => {
  const result = plantFinderDisplayTitle(
    { displayName: "Acer palmatum 'Bloodgood'", preferredCommonNameFr: "Érable japonais", preferredCommonNameEn: "Japanese maple" },
    "fr"
  );
  assert.equal(result.title, "Érable japonais");
  assert.equal(result.scientificSubtitle, "Acer palmatum 'Bloodgood'");
  assert.ok(result.scientificSubtitle.includes("Bloodgood"));
});

test("plantFinderDisplayTitle: fallback — no preferred name for the active locale -> botanical name alone is the title, never blank", () => {
  const result = plantFinderDisplayTitle({ displayName: "Asplenium scolopendrium", preferredCommonNameFr: null, preferredCommonNameEn: null }, "fr");
  assert.equal(result.title, "Asplenium scolopendrium");
  assert.equal(result.scientificSubtitle, null);
});

test("plantFinderDisplayTitle: fallback is per-locale — a name present in fr but missing in en still falls back to the botanical name in en", () => {
  const result = plantFinderDisplayTitle({ displayName: "Some Taxon", preferredCommonNameFr: "Un nom", preferredCommonNameEn: null }, "en");
  assert.equal(result.title, "Some Taxon");
  assert.equal(result.scientificSubtitle, null);
});

test("plantFinderDisplayTitle: an unrecognized/missing locale falls back to fr, matching the i18n layer's own default", () => {
  const result = plantFinderDisplayTitle(LAVANDULA, "de");
  assert.equal(result.title, "Lavande officinale");
});

test("plantFinderDisplayTitle: neither name known -> title is null, never a fabricated placeholder", () => {
  const result = plantFinderDisplayTitle({ displayName: null, preferredCommonNameFr: null, preferredCommonNameEn: null }, "fr");
  assert.equal(result.title, null);
  assert.equal(result.scientificSubtitle, null);
});

test("plantFinderDisplayTitle: tolerates a missing plant object without throwing", () => {
  assert.deepEqual(plantFinderDisplayTitle(undefined, "fr"), { title: null, scientificSubtitle: null });
});

// ---------------------------------------------------------------------------
// Plant Detail premium redesign round 1: formatFloweringSeason (compact
// min-max span) and formatPlantGlance (the deterministic "at a glance"
// synthesis, built only from existing structured fields).

test("formatFloweringSeason: a multi-month range becomes a lowercase fr min–max span", () => {
  assert.equal(formatFloweringSeason([6, 7, 8], t, "fr"), "juin–août");
});

test("formatFloweringSeason: the same months in en keep normal capitalization", () => {
  assert.equal(formatFloweringSeason([6, 7, 8], createTranslator("en"), "en"), "June–August");
});

test("formatFloweringSeason: a single month is shown once, no dash", () => {
  assert.equal(formatFloweringSeason([4], t, "fr"), "avril");
});

test("formatFloweringSeason: unsorted input is still ordered by min/max, not array order", () => {
  assert.equal(formatFloweringSeason([8, 4, 6], t, "fr"), "avril–août");
});

test("formatFloweringSeason: null/empty -> null, never a fabricated season", () => {
  assert.equal(formatFloweringSeason(null, t, "fr"), null);
  assert.equal(formatFloweringSeason([], t, "fr"), null);
});

test("formatPlantGlance: full ingredient set joins every segment with the same separator, fr", () => {
  const glance = formatPlantGlance(
    { plantType: "shrub", evergreen: true, sun: ["full_sun"], floweringMonths: [6, 7, 8], waterNeed: "modéré", containerSuitable: null },
    t,
    "fr"
  );
  assert.equal(glance, "Arbuste · Feuillage persistant · Plein soleil · Floraison juin–août · Besoin en eau modéré");
});

test("formatPlantGlance: en locale re-derives the same segments from the same data, no hardcoded fr text", () => {
  const glance = formatPlantGlance(
    { plantType: "shrub", evergreen: true, sun: ["full_sun"], floweringMonths: [6, 7, 8], waterNeed: null, containerSuitable: true },
    createTranslator("en"),
    "en"
  );
  assert.equal(glance, "Shrub · Evergreen foliage · Full sun · Flowering June–August · Container growing");
});

test("formatPlantGlance: missing fields are omitted cleanly, never shown as a blank/N-A segment", () => {
  const glance = formatPlantGlance({ plantType: "fern", evergreen: null, sun: null, floweringMonths: null, waterNeed: null, containerSuitable: false }, t, "fr");
  assert.equal(glance, "Fougère");
});

test("formatPlantGlance: evergreen=false and containerSuitable=false are both omitted, not shown as negative claims", () => {
  const glance = formatPlantGlance(
    { plantType: "perennial", evergreen: false, sun: ["partial_sun"], floweringMonths: null, waterNeed: null, containerSuitable: false },
    t,
    "fr"
  );
  assert.equal(glance, "Vivace · Mi-ombre");
});

test("formatPlantGlance: every field missing -> null, so the caller can hide the whole block", () => {
  assert.equal(formatPlantGlance({ plantType: null, evergreen: null, sun: null, floweringMonths: null, waterNeed: null, containerSuitable: null }, t, "fr"), null);
});

test("formatPlantGlance: tolerates a missing plant object without throwing", () => {
  assert.equal(formatPlantGlance(undefined, t, "fr"), null);
});
