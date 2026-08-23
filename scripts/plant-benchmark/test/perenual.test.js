import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDimensionCm, extractDimensionEntriesCm, mapPerenualDetailToTraits, isLimitedCatalogAccessTier, classifySearchResult } from "../src/providers/perenual.js";
import { selectCandidate } from "../src/candidateSelection.js";

const RETRIEVED_AT = "2026-01-01T00:00:00.000Z";

// Real `species/details` fixture, verified live for Acer palmatum (id
// intentionally NOT the real one used in testing — see task note: never
// hardcode a real Perenual ID in the benchmark, this fixture id is just a
// local placeholder for unit tests).
const REAL_PERENUAL_FIXTURE = {
  type: "tree",
  dimensions: [
    { type: "Height", min_value: 20, max_value: 20, unit: "feet" },
  ],
  sunlight: ["full sun", "part shade"],
  soil: ["Well-drained"],
  hardiness: { min: "6", max: "6" },
  watering: "Average",
  drought_tolerant: false,
  growth_rate: "Low",
  attracts: [],
  flowering_season: "Spring",
  edible_fruit: false,
  edible_leaf: false,
  cultivar: null,
  variety: null,
  subspecies: null,
  hybrid: null,
  container: null,
  indoor: false,
  cycle: "Perennial",
};

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

// --- Corrections after real-API testing ---------------------------------

test("perenual: dimensions is an ARRAY in real responses — Height 20 feet -> 609.6cm (min and max)", () => {
  const entries = extractDimensionEntriesCm([{ type: "Height", min_value: 20, max_value: 20, unit: "feet" }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].traitPrefix, "height");
  assert.equal(entries[0].rawMin, 20);
  assert.equal(entries[0].rawMax, 20);
  assert.equal(entries[0].minCm, 609.6);
  assert.equal(entries[0].maxCm, 609.6);
});

test("perenual: dimensions[].type matched case-insensitively; unrecognized type never guessed/invented", () => {
  const entries = extractDimensionEntriesCm([
    { type: "height", min_value: 1, max_value: 2, unit: "m" },
    { type: "Some Unknown Dimension", min_value: 1, max_value: 2, unit: "m" },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].traitPrefix, "height");
});

test("perenual: mapPerenualDetailToTraits reads the array dimensions form -> height_min_cm/height_max_cm, never a fabricated spread", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { dimensions: [{ type: "Height", min_value: 20, max_value: 20, unit: "feet" }] },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.height_max_cm.observations[0].raw_value, 20);
  assert.equal(traits.height_max_cm.observations[0].raw_unit, "feet");
  assert.equal(traits.height_max_cm.observations[0].normalized_value, 609.6);
  assert.equal(traits.height_min_cm.observations[0].normalized_value, 609.6);
  assert.equal(traits.spread_max_cm, undefined);
  assert.equal(traits.spread_min_cm, undefined);
});

test("perenual: container_suitable comes ONLY from `container`, never from `indoor` (real data: container=null, indoor=false)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { container: null, indoor: false },
    retrievedAt: RETRIEVED_AT,
  });
  // container=null -> container_suitable never fabricated from indoor=false.
  assert.equal(traits.container_suitable, undefined);
  // indoor is kept as its own distinct raw trait.
  assert.equal(traits.indoor.observations[0].normalized_value, false);
});

test("perenual: container=true/false map directly, independent of indoor", () => {
  const trueCase = mapPerenualDetailToTraits({
    candidateId: 1, sourceUrl: "https://example.test/1",
    detailData: { container: true, indoor: false }, retrievedAt: RETRIEVED_AT,
  });
  assert.equal(trueCase.traits.container_suitable.observations[0].normalized_value, true);

  const falseCase = mapPerenualDetailToTraits({
    candidateId: 1, sourceUrl: "https://example.test/1",
    detailData: { container: false, indoor: true }, retrievedAt: RETRIEVED_AT,
  });
  assert.equal(falseCase.traits.container_suitable.observations[0].normalized_value, false);
});

test("perenual: flowering_season never feeds flowering_months (Spring is never turned into month numbers)", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: { flowering_season: "Spring" },
    retrievedAt: RETRIEVED_AT,
  });
  assert.equal(traits.flowering_season.observations[0].normalized_value, "Spring");
  assert.equal(traits.flowering_months, undefined);
});

test("perenual: real fixture (Acer palmatum species/details shape) maps correctly end to end", () => {
  const { traits } = mapPerenualDetailToTraits({
    candidateId: 1,
    sourceUrl: "https://example.test/1",
    detailData: REAL_PERENUAL_FIXTURE,
    retrievedAt: RETRIEVED_AT,
  });

  // dimensions[] -> height_min_cm/height_max_cm, 20 feet -> 609.6cm.
  assert.equal(traits.height_max_cm.observations[0].normalized_value, 609.6);
  assert.equal(traits.height_min_cm.observations[0].normalized_value, 609.6);

  // container=null + indoor=false -> container_suitable never fabricated.
  assert.equal(traits.container_suitable, undefined);
  assert.equal(traits.indoor.observations[0].normalized_value, false);

  // flowering_season kept distinct, never feeds flowering_months.
  assert.equal(traits.flowering_season.observations[0].normalized_value, "Spring");
  assert.equal(traits.flowering_months, undefined);

  // edible_fruit=false + edible_leaf=false -> edible=false (all supported
  // components explicitly false).
  assert.equal(traits.edible.observations[0].normalized_value, false);

  // cycle="Perennial" never infers evergreen.
  assert.equal(traits.evergreen, undefined);

  // other straightforward fields still map as-is.
  assert.equal(traits.growth_form.observations[0].raw_value, "tree");
  assert.equal(traits.growth_rate.observations[0].raw_value, "Low");
  assert.equal(traits.drought_tolerance.observations[0].raw_value, false);
  assert.equal(traits.hardiness_min.observations[0].raw_value, "6");
  assert.equal(traits.hardiness_max.observations[0].raw_value, "6");
});

// --- unresolved_under_plan (Personal-tier limited-catalog methodology) --

test("isLimitedCatalogAccessTier: only the documented `personal` tier is limited-catalog, case-insensitively", () => {
  assert.equal(isLimitedCatalogAccessTier("personal"), true);
  assert.equal(isLimitedCatalogAccessTier("Personal"), true);
  assert.equal(isLimitedCatalogAccessTier(" personal "), true);
});

test("isLimitedCatalogAccessTier: premium/supreme/unknown/unset are NEVER treated as limited-catalog", () => {
  assert.equal(isLimitedCatalogAccessTier("premium"), false);
  assert.equal(isLimitedCatalogAccessTier("supreme"), false);
  assert.equal(isLimitedCatalogAccessTier("something_else"), false);
  assert.equal(isLimitedCatalogAccessTier(null), false);
  assert.equal(isLimitedCatalogAccessTier(undefined), false);
  assert.equal(isLimitedCatalogAccessTier(""), false);
});

test("classifySearchResult #1: HTTP 200 + data=[] under the Personal tier -> unresolved_under_plan, never not_found", () => {
  const reason = classifySearchResult({ rawCandidatesLength: 0, accessTier: "personal" });
  assert.equal(reason, "unresolved_under_plan");
  assert.notEqual(reason, "not_found");
});

test("classifySearchResult: empty search under premium/supreme/unset tier is NEVER reclassified (no fabrication without justification)", () => {
  assert.equal(classifySearchResult({ rawCandidatesLength: 0, accessTier: "premium" }), null);
  assert.equal(classifySearchResult({ rawCandidatesLength: 0, accessTier: "supreme" }), null);
  assert.equal(classifySearchResult({ rawCandidatesLength: 0, accessTier: null }), null);
  assert.equal(classifySearchResult({ rawCandidatesLength: 0, accessTier: undefined }), null);
});

test("classifySearchResult #4: a normal accessible result (candidates present) is never touched, even under the Personal tier", () => {
  assert.equal(classifySearchResult({ rawCandidatesLength: 3, accessTier: "personal" }), null);
});
