import { test } from "node:test";
import assert from "node:assert/strict";

import { planBatchGrouping } from "../src/batchGrouping.js";

test("reproduces the exact original Acer/Bloodgood grouping", () => {
  const { plan, uniqueParentNames } = planBatchGrouping([
    { input_name: "Acer palmatum", type: "species" },
    { input_name: "Acer palmatum 'Bloodgood'", type: "cultivar" },
  ]);

  assert.deepEqual(uniqueParentNames, ["Acer palmatum"]);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].catalogRef, "acer_palmatum_species");
  assert.equal(plan[0].parentCatalogRef, null);
  assert.equal(plan[1].catalogRef, "acer_palmatum_bloodgood");
  assert.equal(plan[1].parentCatalogRef, "acer_palmatum_species");
});

test("the real 6-plant pilot batch: 5 taxon families, one with a cultivar", () => {
  const plants = [
    { input_name: "Lavandula angustifolia", type: "species" },
    { input_name: "Hydrangea macrophylla", type: "species" },
    { input_name: "Camellia japonica", type: "species" },
    { input_name: "Rhododendron simsii", type: "species" },
    { input_name: "Malus domestica", type: "species" },
    { input_name: "Hydrangea macrophylla 'Endless Summer'", type: "cultivar" },
  ];
  const { plan, uniqueParentNames } = planBatchGrouping(plants);

  assert.equal(plan.length, 6);
  assert.equal(uniqueParentNames.length, 5); // Hydrangea macrophylla shared by 2 entries

  // Output order matches input order exactly, not grouped/reordered.
  assert.deepEqual(plan.map((p) => p.input_name), plants.map((p) => p.input_name));

  const hydrangeaSpecies = plan.find((p) => p.input_name === "Hydrangea macrophylla");
  const hydrangeaCultivar = plan.find((p) => p.input_name === "Hydrangea macrophylla 'Endless Summer'");
  assert.equal(hydrangeaSpecies.parentCatalogRef, null);
  assert.equal(hydrangeaCultivar.parentCatalogRef, hydrangeaSpecies.catalogRef);
  assert.equal(hydrangeaCultivar.catalogRef, "hydrangea_macrophylla_endless_summer");
  assert.equal(hydrangeaSpecies.catalogRef, "hydrangea_macrophylla_species");

  // The 4 standalone species have no parent_catalog_ref.
  for (const name of ["Lavandula angustifolia", "Camellia japonica", "Rhododendron simsii", "Malus domestica"]) {
    const entry = plan.find((p) => p.input_name === name);
    assert.equal(entry.parentCatalogRef, null);
  }
});

test("rejects an empty batch", () => {
  assert.throws(() => planBatchGrouping([]), /non-empty array/);
});

test("rejects a non-array input", () => {
  assert.throws(() => planBatchGrouping(null), /non-empty array/);
  assert.throws(() => planBatchGrouping({}), /non-empty array/);
});

test("rejects an entry with a missing or empty input_name", () => {
  assert.throws(() => planBatchGrouping([{ type: "species" }]), /input_name/);
  assert.throws(() => planBatchGrouping([{ input_name: "  ", type: "species" }]), /input_name/);
});

test("rejects an invalid type", () => {
  assert.throws(() => planBatchGrouping([{ input_name: "Malus domestica", type: "variety" }]), /invalid type/);
});

test("rejects a cultivar-typed entry with no quoted cultivar name", () => {
  assert.throws(() => planBatchGrouping([{ input_name: "Malus domestica", type: "cultivar" }]), /no quoted cultivar name/);
});

test("rejects a species-typed entry that has a quoted cultivar suffix", () => {
  assert.throws(() => planBatchGrouping([{ input_name: "Hydrangea macrophylla 'Endless Summer'", type: "species" }]), /quoted cultivar suffix/);
});

test("rejects a duplicate input_name", () => {
  assert.throws(
    () =>
      planBatchGrouping([
        { input_name: "Malus domestica", type: "species" },
        { input_name: "Malus domestica", type: "species" },
      ]),
    /duplicate input_name/
  );
});

test("rejects a cultivar whose species parent is not present in the same batch", () => {
  assert.throws(
    () => planBatchGrouping([{ input_name: "Hydrangea macrophylla 'Endless Summer'", type: "cultivar" }]),
    /no matching species entry "Hydrangea macrophylla"/
  );
});

test("a species with several cultivars in the same batch all share one taxon family and the same parent_catalog_ref", () => {
  const { plan, uniqueParentNames } = planBatchGrouping([
    { input_name: "Hydrangea macrophylla", type: "species" },
    { input_name: "Hydrangea macrophylla 'Endless Summer'", type: "cultivar" },
    { input_name: "Hydrangea macrophylla 'Nikko Blue'", type: "cultivar" },
  ]);
  assert.equal(uniqueParentNames.length, 1);
  const species = plan.find((p) => p.type === "species");
  const cultivars = plan.filter((p) => p.type === "cultivar");
  assert.equal(cultivars.length, 2);
  for (const c of cultivars) {
    assert.equal(c.parentCatalogRef, species.catalogRef);
  }
  assert.notEqual(cultivars[0].catalogRef, cultivars[1].catalogRef);
});

test("a single standalone species (no cultivar at all) is valid", () => {
  const { plan, uniqueParentNames } = planBatchGrouping([{ input_name: "Malus domestica", type: "species" }]);
  assert.equal(plan.length, 1);
  assert.equal(uniqueParentNames.length, 1);
  assert.equal(plan[0].parentCatalogRef, null);
  assert.equal(plan[0].catalogRef, "malus_domestica_species");
});
