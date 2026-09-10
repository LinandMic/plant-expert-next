import { test } from "node:test";
import assert from "node:assert/strict";

import { rowToPlant } from "./plantFinderApi.js";

// rowToPlant is a pure row->Plant mapper (no network, no Supabase client
// touched) — safe to unit test in isolation. Covers the new image_*
// columns added alongside plant_catalog's image provenance fields: they
// must round-trip verbatim when present, and never be fabricated (stay
// null) when the row doesn't carry them.

function baseRow(overrides = {}) {
  return {
    id: "1",
    slug: "acer-palmatum",
    entry_type: "species",
    cultivar_name: null,
    display_name: "Acer palmatum",
    common_name: null,
    plant_type: "tree",
    growth_form: null,
    height_min_cm: null,
    height_max_cm: null,
    spread_max_cm: null,
    sun: null,
    evergreen: null,
    water_need: null,
    container_suitable: null,
    edible: null,
    flowering_months: null,
    plant_taxa: null,
    ...overrides,
  };
}

test("rowToPlant: image_* columns present -> mapped verbatim to camelCase", () => {
  const plant = rowToPlant(
    baseRow({
      image_url: "https://example.test/acer.jpg",
      image_alt: "Feuillage rouge d'Acer palmatum",
      image_author: "Jane Doe",
      image_license: "CC BY-SA 4.0",
      image_source_url: "https://commons.wikimedia.org/wiki/File:Acer.jpg",
    })
  );
  assert.equal(plant.imageUrl, "https://example.test/acer.jpg");
  assert.equal(plant.imageAlt, "Feuillage rouge d'Acer palmatum");
  assert.equal(plant.imageAuthor, "Jane Doe");
  assert.equal(plant.imageLicense, "CC BY-SA 4.0");
  assert.equal(plant.imageSourceUrl, "https://commons.wikimedia.org/wiki/File:Acer.jpg");
});

test("rowToPlant: image_* columns absent (undefined, as for every current catalog row) -> all null, never fabricated", () => {
  const plant = rowToPlant(baseRow());
  assert.equal(plant.imageUrl, null);
  assert.equal(plant.imageAlt, null);
  assert.equal(plant.imageAuthor, null);
  assert.equal(plant.imageLicense, null);
  assert.equal(plant.imageSourceUrl, null);
});

test("rowToPlant: image_* columns explicitly null in the row -> stay null (not coerced to empty string or omitted)", () => {
  const plant = rowToPlant(
    baseRow({ image_url: null, image_alt: null, image_author: null, image_license: null, image_source_url: null })
  );
  assert.equal(plant.imageUrl, null);
  assert.equal(plant.imageAlt, null);
  assert.equal(plant.imageAuthor, null);
  assert.equal(plant.imageLicense, null);
  assert.equal(plant.imageSourceUrl, null);
});

test("rowToPlant: existing fields (unrelated to images) are untouched by this change", () => {
  const plant = rowToPlant(baseRow({ plant_type: "shrub", height_max_cm: 120 }));
  assert.equal(plant.plantType, "shrub");
  assert.equal(plant.heightMaxCm, 120);
  assert.equal(plant.slug, "acer-palmatum");
});
