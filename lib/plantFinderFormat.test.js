import { test } from "node:test";
import assert from "node:assert/strict";

import { formatHeightRange, sunLabels, entryTypeLabel, formatBoolean, formatFloweringMonths, plantTypeLabel, plantFinderDisplayTitle } from "./plantFinderFormat.js";

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
  assert.deepEqual(sunLabels(["full_sun"]), ["Plein soleil"]);
  assert.deepEqual(sunLabels(["partial_sun"]), ["Mi-ombre"]);
  assert.deepEqual(sunLabels(["bright_shade"]), ["Ombre lumineuse"]);
  assert.deepEqual(sunLabels(["shade"]), ["Ombre"]);
  assert.deepEqual(sunLabels(["full_sun", "partial_sun"]), ["Plein soleil", "Mi-ombre"]);
});

test("sunLabels: null/empty never invents a value", () => {
  assert.equal(sunLabels(null), null);
  assert.equal(sunLabels(undefined), null);
  assert.equal(sunLabels([]), null);
});

test("entryTypeLabel: species/cultivar/unknown", () => {
  assert.equal(entryTypeLabel("species"), "Espèce");
  assert.equal(entryTypeLabel("cultivar"), "Cultivar");
  assert.equal(entryTypeLabel("genus"), null);
  assert.equal(entryTypeLabel(null), null);
});

test("formatBoolean: null handling — false/true are informative, null/undefined stay unknown", () => {
  assert.equal(formatBoolean(true), "Oui");
  assert.equal(formatBoolean(false), "Non");
  assert.equal(formatBoolean(null), null);
  assert.equal(formatBoolean(undefined), null);
});

test("formatFloweringMonths: sorts and labels in French, null when absent", () => {
  assert.equal(formatFloweringMonths([4, 5, 3]), "Mars, Avril, Mai");
  assert.equal(formatFloweringMonths(null), null);
  assert.equal(formatFloweringMonths([]), null);
});

test("plantTypeLabel: maps every documented DB value to its French label", () => {
  assert.equal(plantTypeLabel("tree"), "Arbre");
  assert.equal(plantTypeLabel("shrub"), "Arbuste");
  assert.equal(plantTypeLabel("perennial"), "Vivace");
  assert.equal(plantTypeLabel("annual"), "Annuelle");
  assert.equal(plantTypeLabel("biennial"), "Bisannuelle");
  assert.equal(plantTypeLabel("grass"), "Graminée");
  assert.equal(plantTypeLabel("climber"), "Grimpante");
  assert.equal(plantTypeLabel("groundcover"), "Couvre-sol");
  assert.equal(plantTypeLabel("fern"), "Fougère");
  assert.equal(plantTypeLabel("bulb"), "Bulbe");
});

test("plantTypeLabel: null/undefined stay null", () => {
  assert.equal(plantTypeLabel(null), null);
  assert.equal(plantTypeLabel(undefined), null);
});

test("plantTypeLabel: an unrecognized value is never guessed and never shown as the raw technical slug", () => {
  assert.equal(plantTypeLabel("liana"), null);
  assert.notEqual(plantTypeLabel("liana"), "liana");
});

test("plantFinderDisplayTitle: common name leads, scientific name becomes the subtitle", () => {
  const result = plantFinderDisplayTitle({ commonName: "Érable du Japon", displayName: "Acer palmatum" });
  assert.equal(result.title, "Érable du Japon");
  assert.equal(result.scientificSubtitle, "Acer palmatum");
});

test("plantFinderDisplayTitle: no common name -> scientific name alone is the title, no duplicate subtitle", () => {
  const result = plantFinderDisplayTitle({ commonName: null, displayName: "Acer palmatum 'Bloodgood'" });
  assert.equal(result.title, "Acer palmatum 'Bloodgood'");
  assert.equal(result.scientificSubtitle, null);
});

test("plantFinderDisplayTitle: neither name known -> title is null, never a fabricated placeholder", () => {
  const result = plantFinderDisplayTitle({ commonName: null, displayName: null });
  assert.equal(result.title, null);
  assert.equal(result.scientificSubtitle, null);
});

test("plantFinderDisplayTitle: tolerates a missing plant object without throwing", () => {
  assert.deepEqual(plantFinderDisplayTitle(undefined), { title: null, scientificSubtitle: null });
});
