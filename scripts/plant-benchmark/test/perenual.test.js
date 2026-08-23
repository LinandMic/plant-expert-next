import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractDimensionCm, extractDimensionEntriesCm, mapPerenualDetailToTraits, isLimitedCatalogAccessTier, classifySearchResult, classifyDetailFailure, queryPerenual } from "../src/providers/perenual.js";
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

  // other straightforward fields still map as-is. `type` maps to
  // plant_type, never to growth_form (spec correction — split from
  // Trefle's distinct specifications.growth_form concept).
  assert.equal(traits.plant_type.observations[0].raw_value, "tree");
  assert.equal(traits.growth_form, undefined);
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

// --- plan_restricted only for a confidently-matched target (spec correction)

test("classifyDetailFailure: exact_scientific_match + 429 upgrade-plan -> plan_restricted", () => {
  assert.equal(classifyDetailFailure({ selectionReason: "exact_scientific_match", detailError: "plan_restricted" }), "plan_restricted");
});

test("classifyDetailFailure: exact_cultivar_match + 429 upgrade-plan -> plan_restricted", () => {
  assert.equal(classifyDetailFailure({ selectionReason: "exact_cultivar_match", detailError: "plan_restricted" }), "plan_restricted");
});

test("classifyDetailFailure: real cases — only a related candidate matched (parent_taxon_match) + 429 -> unresolved_under_plan, never plan_restricted for the target", () => {
  // Reproduces: Viburnum tinus -> only "Viburnum tinus 'Lisarose'" matched;
  // Hosta -> only "Hosta 'Abby'"; Miscanthus sinensis -> only "Miscanthus
  // sinensis 'Autumn Light'"; Malus domestica -> only a Goldrush cultivar.
  const result = classifyDetailFailure({ selectionReason: "parent_taxon_match", detailError: "plan_restricted" });
  assert.equal(result, "unresolved_under_plan");
  assert.notEqual(result, "plan_restricted");
});

test("classifyDetailFailure: ambiguous/fuzzy candidate + 429 -> unresolved_under_plan, never plan_restricted", () => {
  assert.equal(classifyDetailFailure({ selectionReason: "ambiguous", detailError: "plan_restricted" }), "unresolved_under_plan");
  assert.equal(classifyDetailFailure({ selectionReason: "fuzzy_candidate", detailError: "plan_restricted" }), "unresolved_under_plan");
});

test("classifyDetailFailure: a non-plan-restricted detail error is untouched (null -> caller keeps provider_error/original selection_reason)", () => {
  assert.equal(classifyDetailFailure({ selectionReason: "exact_scientific_match", detailError: "timeout" }), null);
  assert.equal(classifyDetailFailure({ selectionReason: "parent_taxon_match", detailError: "http_error" }), null);
});

// --- queryPerenual: /species/details is only ever called for a confident
// match (spec correction) — verified with a mocked HTTP client, zero real
// network. Real cases this fixes: querying "Viburnum tinus" only ever
// matched "Viburnum tinus 'Lisarose'" (parent_taxon_match); "Hosta" only
// matched "Hosta 'Abby'"; querying a species that only matched an
// unrelated cultivar (Goldrush/Autumn Light) — in all of these the old
// code still fetched /species/details for that unrelated candidate.

function makeFetchMock(searchData) {
  let detailCallCount = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/species-list")) {
      return { ok: true, status: 200, data: { data: searchData }, url };
    }
    if (url.includes("/species/details/")) {
      detailCallCount++;
      return { ok: true, status: 200, data: { type: "tree" }, url };
    }
    throw new Error(`unexpected URL in test fetch mock: ${url}`);
  };
  return { fetchImpl, getDetailCallCount: () => detailCallCount };
}

function withTempRawRoot(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plant-benchmark-perenual-test-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("queryPerenual: exact_scientific_match -> detail endpoint called exactly once", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Acer palmatum" }]);
    const result = await queryPerenual({ inputName: "Acer palmatum", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "exact_scientific_match");
    assert.equal(getDetailCallCount(), 1);
  });
});

test("queryPerenual: exact_cultivar_match -> detail endpoint called exactly once", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Hydrangea paniculata 'Bobo'" }]);
    const result = await queryPerenual({ inputName: "Hydrangea paniculata 'Bobo'", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "exact_cultivar_match");
    assert.equal(getDetailCallCount(), 1);
  });
});

test("queryPerenual: parent_taxon_match (real case: Viburnum tinus -> 'Lisarose') -> detail endpoint called 0 times", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Viburnum tinus 'Lisarose'" }]);
    const result = await queryPerenual({ inputName: "Viburnum tinus", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "parent_taxon_match");
    assert.equal(getDetailCallCount(), 0);
    assert.equal(result.error, null);
    assert.deepEqual(result.traits, {});
    // record reflects only search-level data, never a fabricated detail fiche.
    assert.equal(result.record.scientific_name, "Viburnum tinus 'Lisarose'");
  });
});

test("queryPerenual: ambiguous candidate -> detail endpoint called 0 times", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Quercus rubra" }]);
    const result = await queryPerenual({ inputName: "Quercus alba", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "ambiguous");
    assert.equal(getDetailCallCount(), 0);
    assert.equal(result.error, null);
    assert.deepEqual(result.traits, {});
  });
});

test("queryPerenual: skipping the detail call never fabricates an errors.json-worthy error", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl } = makeFetchMock([{ id: 1, scientific_name: "Hosta 'Abby'" }]);
    const result = await queryPerenual({ inputName: "Hosta", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "parent_taxon_match");
    assert.equal(result.error, null);
  });
});

// --- PERENUAL_ACCESS_TIER=personal + non-confident match -> unresolved_under_plan
// (spec correction — real case: querying "Viburnum tinus" only ever
// matches "Viburnum tinus 'Lisarose'", a parent_taxon_match; under the
// Personal tier this must never surface as an exploitable
// parent_taxon_match record.)

test("queryPerenual #1: Personal tier + exact match -> unaffected, detail called normally", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Acer palmatum" }]);
    const result = await queryPerenual({ inputName: "Acer palmatum", rawRoot, apiKey: "test-key", accessTier: "personal", fetchImpl });
    assert.equal(result.selection_reason, "exact_scientific_match");
    assert.equal(getDetailCallCount(), 1);
    assert.equal(result.status, "ok");
  });
});

test("queryPerenual #2: Personal tier + parent_taxon_match (real case: Viburnum tinus -> 'Lisarose') -> unresolved_under_plan, never a raw parent_taxon_match", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Viburnum tinus 'Lisarose'" }]);
    const result = await queryPerenual({ inputName: "Viburnum tinus", rawRoot, apiKey: "test-key", accessTier: "personal", fetchImpl });
    assert.equal(getDetailCallCount(), 0);
    assert.equal(result.status, "unresolved_under_plan");
    assert.equal(result.selection_reason, "unresolved_under_plan");
    assert.notEqual(result.selection_reason, "parent_taxon_match");
    assert.deepEqual(result.traits, {});
    assert.equal(result.error, null);
    // never presented as a validated fiche of the target
    assert.equal(result.record, null);
  });
});

test("queryPerenual #3: Personal tier + ambiguous/non-confident -> unresolved_under_plan, detail 0 calls", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Quercus rubra" }]);
    const result = await queryPerenual({ inputName: "Quercus alba", rawRoot, apiKey: "test-key", accessTier: "personal", fetchImpl });
    assert.equal(getDetailCallCount(), 0);
    assert.equal(result.status, "unresolved_under_plan");
    assert.equal(result.selection_reason, "unresolved_under_plan");
    assert.deepEqual(result.traits, {});
    assert.equal(result.error, null);
  });
});

test("queryPerenual #4: the related candidate stays available in `candidates` (and `search_candidate`) for audit even when reclassified", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl } = makeFetchMock([{ id: 42, scientific_name: "Viburnum tinus 'Lisarose'" }]);
    const result = await queryPerenual({ inputName: "Viburnum tinus", rawRoot, apiKey: "test-key", accessTier: "personal", fetchImpl });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].id, 42);
    assert.equal(result.candidates[0].name, "Viburnum tinus 'Lisarose'");
    assert.equal(result.candidate_count, 1);
    // metadata preserved in an explicitly non-validated field, never `record`.
    assert.equal(result.search_candidate.id, 42);
    assert.equal(result.search_candidate.scientific_name, "Viburnum tinus 'Lisarose'");
  });
});

test("queryPerenual #5: unresolved_under_plan (from a related candidate under Personal tier) does not count as an exploitable record in coverage", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl } = makeFetchMock([{ id: 1, scientific_name: "Hosta 'Abby'" }]);
    const result = await queryPerenual({ inputName: "Hosta", rawRoot, apiKey: "test-key", accessTier: "personal", fetchImpl });
    // eligibleCount()/record coverage in coverage.js only recognizes
    // exact_scientific_match/exact_cultivar_match/parent_taxon_match/
    // parent_only as eligible — unresolved_under_plan is deliberately not
    // in that set (see coverage.test.js for the denominator-level proof).
    const ELIGIBLE_REASONS = new Set(["exact_scientific_match", "exact_cultivar_match", "parent_taxon_match", "parent_only"]);
    assert.equal(ELIGIBLE_REASONS.has(result.selection_reason), false);
    assert.equal(result.selection_reason, "unresolved_under_plan");
  });
});

test("queryPerenual: outside a limited-catalog tier, parent_taxon_match is NOT reclassified (existing behavior preserved)", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl, getDetailCallCount } = makeFetchMock([{ id: 1, scientific_name: "Viburnum tinus 'Lisarose'" }]);
    const result = await queryPerenual({ inputName: "Viburnum tinus", rawRoot, apiKey: "test-key", accessTier: "premium", fetchImpl });
    assert.equal(getDetailCallCount(), 0);
    assert.equal(result.selection_reason, "parent_taxon_match");
    assert.notEqual(result.selection_reason, "unresolved_under_plan");
    assert.equal(result.record.scientific_name, "Viburnum tinus 'Lisarose'");
  });
});

test("queryPerenual: no accessTier configured, parent_taxon_match is NOT reclassified either (existing behavior preserved)", async () => {
  await withTempRawRoot(async (rawRoot) => {
    const { fetchImpl } = makeFetchMock([{ id: 1, scientific_name: "Viburnum tinus 'Lisarose'" }]);
    const result = await queryPerenual({ inputName: "Viburnum tinus", rawRoot, apiKey: "test-key", fetchImpl });
    assert.equal(result.selection_reason, "parent_taxon_match");
  });
});
