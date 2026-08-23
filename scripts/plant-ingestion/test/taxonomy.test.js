import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTaxonDryRun, buildTaxonNames } from "../src/taxonomy.js";

const ACCEPTED_ACER_TAXONOMY = {
  canonical_name: "Acer palmatum",
  accepted_name: "Acer palmatum",
  taxonomic_status: "ACCEPTED",
  taxonomic_rank: "SPECIES",
  family: "Sapindaceae",
  genus: "Acer",
  species: "palmatum",
  infraspecific_name: null,
  accepted_taxon_id: "2876739",
  source_taxon_id: "2876739",
  synonyms: ["Acer polymorphum"],
};

test("buildTaxonDryRun: an accepted WCVP taxonomy builds a taxon dry-run object, not blocked", () => {
  const { taxon, taxon_ref, blocked, warnings } = buildTaxonDryRun(ACCEPTED_ACER_TAXONOMY);
  assert.equal(blocked, false);
  assert.deepEqual(warnings, []);
  assert.equal(taxon.rank, "species");
  assert.equal(taxon.genus, "Acer");
  assert.equal(taxon.canonical_name, "Acer palmatum");
  assert.equal(taxon.taxonomic_status, "accepted");
  assert.equal(taxon.wcvp_taxon_id, "2876739");
  assert.equal(taxon_ref, "acer_palmatum");
});

test("buildTaxonDryRun: ambiguous/not_found WCVP result (taxonomy=null) is blocked, never a fabricated taxon", () => {
  const { taxon, taxon_ref, blocked, warnings } = buildTaxonDryRun(null);
  assert.equal(blocked, true);
  assert.equal(taxon, null);
  assert.equal(taxon_ref, null);
  assert.ok(warnings.length > 0);
});

test("buildTaxonDryRun: a synonym-status taxonomy is blocked rather than presented as accepted", () => {
  const { blocked } = buildTaxonDryRun({ ...ACCEPTED_ACER_TAXONOMY, taxonomic_status: "SYNONYM" });
  assert.equal(blocked, true);
});

test("buildTaxonDryRun: unrecognized rank is blocked, never guessed", () => {
  const { blocked, warnings } = buildTaxonDryRun({ ...ACCEPTED_ACER_TAXONOMY, taxonomic_rank: "SECTION" });
  assert.equal(blocked, true);
  assert.ok(warnings.some((w) => w.includes("rank")));
});

test("buildTaxonNames: includes the accepted name plus only real WCVP-provided synonyms, never invented ones", () => {
  const names = buildTaxonNames(ACCEPTED_ACER_TAXONOMY, "acer_palmatum");
  assert.equal(names.length, 2);
  assert.equal(names[0].name_type, "accepted");
  assert.equal(names[0].name, "Acer palmatum");
  assert.equal(names[0].normalized_name, "acer palmatum");
  assert.equal(names[1].name_type, "synonym");
  assert.equal(names[1].name, "Acer polymorphum");
});

test("buildTaxonNames: no synonyms in WCVP response -> only the accepted row, nothing invented", () => {
  const names = buildTaxonNames({ ...ACCEPTED_ACER_TAXONOMY, synonyms: [] }, "acer_palmatum");
  assert.equal(names.length, 1);
  assert.equal(names[0].name_type, "accepted");
});
