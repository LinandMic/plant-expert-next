import { test } from "node:test";
import assert from "node:assert/strict";

import { runInvariants } from "../../src/plan/invariants.js";

function basePlan(overrides = {}) {
  return {
    taxa: [{ taxon_ref: "acer_palmatum", wcvp_taxon_id: "207798951" }],
    taxonNames: [{ taxon_ref: "acer_palmatum", normalized_name: "acer palmatum", name_type: "accepted" }],
    catalogEntries: [
      { catalog_ref: "acer_palmatum_species", taxon_ref: "acer_palmatum", entry_type: "species", parent_catalog_ref: null, publication_status: "draft", review_status: "unreviewed" },
    ],
    sourceRecords: [{ source_record_ref: "acer_palmatum_species:perenual", catalog_ref: "acer_palmatum_species", provider: "perenual" }],
    observations: [{ observation_ref: "acer_palmatum_species:perenual:plant_type", catalog_ref: "acer_palmatum_species", provider: "perenual", trait: "plant_type", normalized_value: "tree" }],
    selections: [{ catalog_ref: "acer_palmatum_species", trait: "plant_type", selected_observation_ref: "acer_palmatum_species:perenual:plant_type" }],
    ...overrides,
  };
}

test("a fully consistent plan produces no invariant errors", () => {
  const plan = basePlan();
  plan.catalogEntries[0].plant_type = "tree"; // promoted
  assert.deepEqual(runInvariants(plan), []);
});

test("invariant A: duplicate wcvp_taxon_id across taxa is flagged", () => {
  const plan = basePlan({ taxa: [{ taxon_ref: "a", wcvp_taxon_id: "1" }, { taxon_ref: "b", wcvp_taxon_id: "1" }] });
  assert.ok(runInvariants(plan).some((e) => e.code === "INVARIANT_A_DUPLICATE_TAXON"));
});

test("invariant D: two species catalog entries for the same taxon is flagged", () => {
  const plan = basePlan({
    catalogEntries: [
      { catalog_ref: "s1", taxon_ref: "acer_palmatum", entry_type: "species", publication_status: "draft", review_status: "unreviewed" },
      { catalog_ref: "s2", taxon_ref: "acer_palmatum", entry_type: "species", publication_status: "draft", review_status: "unreviewed" },
    ],
    observations: [],
    selections: [],
  });
  assert.ok(runInvariants(plan).some((e) => e.code === "INVARIANT_D_DUPLICATE_SPECIES"));
});

test("invariant N: catalog typed value not matching the promoted selection is flagged", () => {
  const plan = basePlan();
  plan.catalogEntries[0].plant_type = "shrub"; // NOT promoted correctly (should be "tree")
  assert.ok(runInvariants(plan).some((e) => e.code === "INVARIANT_N_PROMOTION_MISMATCH"));
});

test("invariant O/P: a non-draft or non-unreviewed catalog entry is flagged", () => {
  const plan = basePlan({ observations: [], selections: [] });
  plan.catalogEntries[0].publication_status = "published";
  plan.catalogEntries[0].review_status = "reviewed";
  const errors = runInvariants(plan);
  assert.ok(errors.some((e) => e.code === "INVARIANT_O_NOT_DRAFT"));
  assert.ok(errors.some((e) => e.code === "INVARIANT_P_NOT_UNREVIEWED"));
});
