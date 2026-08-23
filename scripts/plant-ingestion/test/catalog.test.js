import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSpeciesCatalogEntry, buildCultivarCatalogEntry } from "../src/catalog.js";

const SHARED_TAXON_REF = "acer_palmatum";
const CANONICAL_NAME = "Acer palmatum";

// Test #9: Bloodgood shares the Acer palmatum taxon — never a fictional
// "Acer palmatum Bloodgood" taxon. Both builders are given the SAME
// resolved taxon_ref (as bundle.js does, from one shared WCVP resolution),
// and the resulting catalog entries must reflect that.
test("#9: cultivar catalog entry shares the species' taxon_ref", () => {
  const species = buildSpeciesCatalogEntry({ catalogRef: "acer_palmatum_species", wcvpTaxonRef: SHARED_TAXON_REF, canonicalName: CANONICAL_NAME });
  const cultivar = buildCultivarCatalogEntry({
    catalogRef: "acer_palmatum_bloodgood",
    wcvpTaxonRef: SHARED_TAXON_REF,
    canonicalName: CANONICAL_NAME,
    cultivarName: "Bloodgood",
    parentCatalogRef: species.catalog_ref,
  });

  assert.equal(cultivar.taxon_ref, species.taxon_ref);
  assert.equal(cultivar.taxon_ref, SHARED_TAXON_REF);
});

// Test #10: the cultivar's parent_catalog_ref points at the species entry.
test("#10: cultivar catalog entry's parent_catalog_ref points at the species catalog_ref", () => {
  const species = buildSpeciesCatalogEntry({ catalogRef: "acer_palmatum_species", wcvpTaxonRef: SHARED_TAXON_REF, canonicalName: CANONICAL_NAME });
  const cultivar = buildCultivarCatalogEntry({
    catalogRef: "acer_palmatum_bloodgood",
    wcvpTaxonRef: SHARED_TAXON_REF,
    canonicalName: CANONICAL_NAME,
    cultivarName: "Bloodgood",
    parentCatalogRef: species.catalog_ref,
  });

  assert.equal(cultivar.parent_catalog_ref, species.catalog_ref);
  assert.equal(species.parent_catalog_ref, null);
});

// Test #15: nothing is ever auto-published by this dry-run tool.
test("#15: both species and cultivar entries stay publication_status=draft", () => {
  const species = buildSpeciesCatalogEntry({ catalogRef: "acer_palmatum_species", wcvpTaxonRef: SHARED_TAXON_REF, canonicalName: CANONICAL_NAME });
  const cultivar = buildCultivarCatalogEntry({
    catalogRef: "acer_palmatum_bloodgood",
    wcvpTaxonRef: SHARED_TAXON_REF,
    canonicalName: CANONICAL_NAME,
    cultivarName: "Bloodgood",
    parentCatalogRef: species.catalog_ref,
  });

  assert.equal(species.publication_status, "draft");
  assert.equal(cultivar.publication_status, "draft");
  assert.equal(species.review_status, "unreviewed");
  assert.equal(cultivar.review_status, "unreviewed");
  assert.equal(species.published_at, null);
  assert.equal(cultivar.published_at, null);
});

test("catalog entries expose hardiness_min_rank/hardiness_max_rank explicitly as null", () => {
  const species = buildSpeciesCatalogEntry({ catalogRef: "acer_palmatum_species", wcvpTaxonRef: SHARED_TAXON_REF, canonicalName: CANONICAL_NAME });
  assert.equal(species.hardiness_min_rank, null);
  assert.equal(species.hardiness_max_rank, null);
});

test("cultivar entry composes its display_name and entry_type correctly", () => {
  const cultivar = buildCultivarCatalogEntry({
    catalogRef: "acer_palmatum_bloodgood",
    wcvpTaxonRef: SHARED_TAXON_REF,
    canonicalName: CANONICAL_NAME,
    cultivarName: "Bloodgood",
    parentCatalogRef: "acer_palmatum_species",
  });
  assert.equal(cultivar.entry_type, "cultivar");
  assert.equal(cultivar.cultivar_name, "Bloodgood");
  assert.equal(cultivar.display_name, "Acer palmatum 'Bloodgood'");
});
