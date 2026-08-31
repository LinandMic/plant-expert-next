import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeTaxa, dedupeTaxonNames } from "../../src/plan/dedupeTaxonomy.js";

const TAXON = {
  taxon_ref: "acer_palmatum",
  rank: "species",
  genus: "Acer",
  species: "palmatum",
  infraspecific_epithet: null,
  canonical_name: "Acer palmatum",
  scientific_name_full: null,
  family: "Sapindaceae",
  taxonomic_status: "accepted",
  wcvp_taxon_id: "207798951",
};

function plantWithTaxonomy(name, taxon, names) {
  return { input: { name }, taxonomy: { ...taxon, names } };
}

const ACCEPTED_NAME = { taxon_ref: "acer_palmatum", name: "Acer palmatum", normalized_name: "acer palmatum", name_type: "accepted", source_taxon_id: "207798951" };
const SYNONYM = { taxon_ref: "acer_palmatum", name: "Acer polymorphum", normalized_name: "acer polymorphum", name_type: "synonym", source_taxon_id: null };

// Item 1: identical duplicate taxon -> deduplicated to one.
test("1: identical duplicate taxon is deduplicated to a single row", () => {
  const plants = [plantWithTaxonomy("Acer palmatum", TAXON, [ACCEPTED_NAME]), plantWithTaxonomy("Acer palmatum 'Bloodgood'", TAXON, [ACCEPTED_NAME])];
  const { taxa, errors } = dedupeTaxa(plants);
  assert.deepEqual(errors, []);
  assert.equal(taxa.length, 1);
  assert.equal(taxa[0].wcvp_taxon_id, "207798951");
});

// Item 2: contradictory duplicate taxon (same wcvp_taxon_id, different
// field) -> rejected, never silently resolved by picking the first one.
test("2: contradictory duplicate taxon (same wcvp_taxon_id, different family) is rejected", () => {
  const contradictory = { ...TAXON, family: "SomethingElse" };
  const plants = [plantWithTaxonomy("Acer palmatum", TAXON, [ACCEPTED_NAME]), plantWithTaxonomy("Acer palmatum 'Bloodgood'", contradictory, [ACCEPTED_NAME])];
  const { errors } = dedupeTaxa(plants);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "TAXON_CONTRADICTION");
});

// Item 3: repeated taxonomic names -> deduplicated.
test("3: repeated taxon_names (accepted + synonym) across two plants are deduplicated", () => {
  const plants = [plantWithTaxonomy("Acer palmatum", TAXON, [ACCEPTED_NAME, SYNONYM]), plantWithTaxonomy("Acer palmatum 'Bloodgood'", TAXON, [ACCEPTED_NAME, SYNONYM])];
  const { taxonNames, errors } = dedupeTaxonNames(plants);
  assert.deepEqual(errors, []);
  assert.equal(taxonNames.length, 2);
});

// Item 4: repeated name with contradictory data -> rejected.
test("4: repeated name_type for the same key with contradictory data is rejected", () => {
  const contradictorySynonym = { ...SYNONYM, name_type: "accepted" }; // same key, different name_type
  const plants = [plantWithTaxonomy("Acer palmatum", TAXON, [SYNONYM]), plantWithTaxonomy("Acer palmatum 'Bloodgood'", TAXON, [contradictorySynonym])];
  const { errors } = dedupeTaxonNames(plants);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "TAXON_NAME_CONTRADICTION");
});
