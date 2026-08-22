import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDimensionCm, mapPerenualDetailToTraits } from "../src/providers/perenual.js";
import { selectCandidate } from "../src/candidateSelection.js";

const RETRIEVED_AT = "2026-01-01T00:00:00.000Z";

test("perenual #1: dimensions min_value/max_value (spec §2, not .min/.max)", () => {
  const { raw, unit, cm } = extractDimensionCm({ min_value: 50, max_value: 300, unit: "cm" }, "max_value");
  assert.equal(raw, 300);
  assert.equal(unit, "cm");
  assert.equal(cm, 300);

  const min = extractDimensionCm({ min_value: 50, max_value: 300, unit: "cm" }, "min_value");
  assert.equal(min.raw, 50);
  assert.equal(min.cm, 50);
});

test("perenual: dimensions.min/.max (old, undocumented shape) are NOT read", () => {
  // Regression guard for the bug this revision fixes: a payload using the
  // old `.min`/`.max` keys must not silently produce a value.
  const { raw, cm } = extractDimensionCm({ min: 50, max: 300, unit: "cm" }, "max_value");
  assert.equal(raw, null);
  assert.equal(cm, null);
});

test("mapPerenualDetailToTraits: height via dimensions, min_value/max_value", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { dimensions: { min_value: 100, max_value: 300, unit: "cm" } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm.observations[0].raw_value, 300);
  assert.equal(traits.height_max_cm.observations[0].normalized_value, 300);
  assert.equal(traits.height_min_cm.observations[0].normalized_value, 100);
});

test("mapPerenualDetailToTraits: unsupported dimension unit -> normalized_value null, raw kept", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { dimensions: { max_value: 12, unit: "furlong" } },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm.observations[0].raw_value, 12);
  assert.equal(traits.height_max_cm.observations[0].raw_unit, "furlong");
  assert.equal(traits.height_max_cm.observations[0].normalized_value, null);
});

test("mapPerenualDetailToTraits: evergreen is never inferred from `cycle` (spec §4)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { cycle: "Perennial" },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.evergreen, undefined);
});

test("mapPerenualDetailToTraits: edible derived rule (spec §5) — true if >=1 explicit true", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: true, edible_leaf: false },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible_fruit.observations[0].normalized_value, true);
  assert.equal(traits.edible_leaf.observations[0].normalized_value, false);
  assert.equal(traits.edible.observations[0].normalized_value, true);
});

test("mapPerenualDetailToTraits: edible three-state — fruit=false + leaf=null -> edible=null (never a naive false)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: false, edible_leaf: null },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible.observations[0].normalized_value, null);
});

test("mapPerenualDetailToTraits: edible three-state — fruit=null + leaf=false -> edible=null", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: null, edible_leaf: false },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible.observations[0].normalized_value, null);
});

test("mapPerenualDetailToTraits: edible three-state — fruit=false + leaf=false -> edible=false (all supported components explicitly false)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: false, edible_leaf: false },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible.observations[0].normalized_value, false);
});

test("mapPerenualDetailToTraits: edible three-state — fruit=true + leaf=false -> edible=true (any true wins)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: true, edible_leaf: false },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible.observations[0].normalized_value, true);
});

test("mapPerenualDetailToTraits: edible three-state — fruit=null + leaf=null -> edible=null", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { edible_fruit: null, edible_leaf: null },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible.observations[0].normalized_value, null);
});

test("mapPerenualDetailToTraits: edible absent entirely when neither field present", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: {},
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.edible, undefined);
  assert.equal(traits.edible_fruit, undefined);
});

test("perenual #5: candidate selection — cultivar exact preferred over parent species", () => {
  const candidates = [
    { id: 1, rawName: "Hydrangea paniculata" },
    { id: 2, rawName: "Hydrangea paniculata 'Bobo'" },
  ];
  const { selected, selection_reason } = selectCandidate({ parentName: "Hydrangea paniculata", cultivarName: "Bobo", candidates });
  assert.equal(selected.id, 2);
  assert.equal(selection_reason, "exact_cultivar_match");
});

test("perenual #6: parent species only for a cultivar query -> parent_only, never a false match", () => {
  const candidates = [{ id: 1, rawName: "Hydrangea paniculata" }];
  const { selected, selection_reason } = selectCandidate({ parentName: "Hydrangea paniculata", cultivarName: "Bobo", candidates });
  assert.equal(selected.id, 1);
  assert.equal(selection_reason, "parent_only");
  assert.notEqual(selection_reason, "exact_cultivar_match");
});
