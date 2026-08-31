import { test } from "node:test";
import assert from "node:assert/strict";

import { compileCatalogEntries } from "../../src/plan/compileCatalog.js";

function speciesCatalog(overrides = {}) {
  return { catalog_ref: "acer_palmatum_species", taxon_ref: "acer_palmatum", entry_type: "species", cultivar_name: null, parent_catalog_ref: null, display_name: "Acer palmatum", slug: "acer-palmatum", publication_status: "draft", review_status: "unreviewed", published_at: null, hardiness_min_rank: null, hardiness_max_rank: null, ...overrides };
}

function cultivarCatalog(overrides = {}) {
  return { catalog_ref: "acer_palmatum_bloodgood", taxon_ref: "acer_palmatum", entry_type: "cultivar", cultivar_name: "Bloodgood", parent_catalog_ref: "acer_palmatum_species", display_name: "Acer palmatum 'Bloodgood'", slug: "acer-palmatum-bloodgood", publication_status: "draft", review_status: "unreviewed", published_at: null, hardiness_min_rank: null, hardiness_max_rank: null, ...overrides };
}

test("catalog entries ordered species before cultivar regardless of input order", () => {
  const plants = [{ catalog: cultivarCatalog() }, { catalog: speciesCatalog() }];
  const { catalogEntries, errors } = compileCatalogEntries(plants);
  assert.deepEqual(errors, []);
  assert.equal(catalogEntries[0].entry_type, "species");
  assert.equal(catalogEntries[1].entry_type, "cultivar");
});

// Item 5: cultivar with an absent parent -> rejected.
test("5: cultivar whose parent_catalog_ref does not resolve to any entry is rejected", () => {
  const plants = [{ catalog: cultivarCatalog({ parent_catalog_ref: "does_not_exist" }) }];
  const { errors } = compileCatalogEntries(plants);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "CULTIVAR_PARENT_NOT_FOUND");
});

// Item 6: cultivar whose parent is itself a cultivar (not species) -> rejected.
test("6: cultivar whose parent_catalog_ref resolves to a non-species entry is rejected", () => {
  const plants = [
    { catalog: cultivarCatalog({ catalog_ref: "acer_palmatum_atropurpureum", cultivar_name: "Atropurpureum", parent_catalog_ref: "acer_palmatum_bloodgood" }) },
    { catalog: cultivarCatalog() }, // acer_palmatum_bloodgood, itself a cultivar
  ];
  const { errors } = compileCatalogEntries(plants);
  assert.ok(errors.some((e) => e.code === "CULTIVAR_PARENT_NOT_SPECIES"));
});

test("a valid species+cultivar pair produces no errors", () => {
  const plants = [{ catalog: speciesCatalog() }, { catalog: cultivarCatalog() }];
  const { errors } = compileCatalogEntries(plants);
  assert.deepEqual(errors, []);
});
