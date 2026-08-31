import { test } from "node:test";
import assert from "node:assert/strict";

import { composeTaxonomyField } from "../src/bundle.js";

const SHARED_TAXON = {
  blocked: false,
  taxon: {
    taxon_ref: "acer_palmatum",
    rank: "species",
    genus: "Acer",
    species: "palmatum",
    infraspecific_epithet: null,
    canonical_name: "Acer palmatum",
    scientific_name_full: null,
    family: "Sapindaceae",
    taxonomic_status: "accepted",
    wcvp_taxon_id: "2876739",
  },
  names: [
    { taxon_ref: "acer_palmatum", name: "Acer palmatum", normalized_name: "acer palmatum", name_type: "accepted", source_taxon_id: "2876739" },
  ],
};

test("composeTaxonomyField: exposes taxon_names dry-run rows explicitly under taxonomy.names", () => {
  const taxonomy = composeTaxonomyField(SHARED_TAXON);
  assert.ok(Array.isArray(taxonomy.names));
  assert.equal(taxonomy.names.length, 1);
  assert.equal(taxonomy.names[0].name_type, "accepted");
  assert.equal(taxonomy.names[0].name, "Acer palmatum");
  // Core plant_taxa fields are still present alongside `names`.
  assert.equal(taxonomy.taxon_ref, "acer_palmatum");
  assert.equal(taxonomy.rank, "species");
});

test("composeTaxonomyField: blocked shared taxon composes to null (no fabricated taxonomy)", () => {
  assert.equal(composeTaxonomyField({ blocked: true, taxon: null, names: [] }), null);
});

test("composeTaxonomyField: the SAME shared taxon reused for species and cultivar never produces a Bloodgood-specific WCVP name", () => {
  // bundle.js calls composeTaxonomyField(sharedTaxon) once per plant entry,
  // but always with the SAME sharedTaxon object resolved once for the
  // parent species — so calling it twice must yield identical `names`.
  const speciesTaxonomy = composeTaxonomyField(SHARED_TAXON);
  const cultivarTaxonomy = composeTaxonomyField(SHARED_TAXON);

  assert.deepEqual(cultivarTaxonomy.names, speciesTaxonomy.names);
  assert.ok(!cultivarTaxonomy.names.some((n) => /bloodgood/i.test(n.name)));
});
