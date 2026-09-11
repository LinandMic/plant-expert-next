import { test } from "node:test";
import assert from "node:assert/strict";

import { rowToPlant, searchPublishedPlants, buildSearchRpcParams } from "./plantFinderApi.js";

// rowToPlant is a pure row->Plant mapper (no network, no Supabase client
// touched) — safe to unit test in isolation. Covers the new image_*
// columns added alongside plant_catalog's image provenance fields: they
// must round-trip verbatim when present, and never be fabricated (stay
// null) when the row doesn't carry them.

function baseRow(overrides = {}) {
  return {
    id: "1",
    slug: "acer-palmatum",
    entry_type: "species",
    cultivar_name: null,
    display_name: "Acer palmatum",
    common_name: null,
    plant_type: "tree",
    growth_form: null,
    height_min_cm: null,
    height_max_cm: null,
    spread_max_cm: null,
    sun: null,
    evergreen: null,
    water_need: null,
    container_suitable: null,
    edible: null,
    flowering_months: null,
    plant_taxa: null,
    ...overrides,
  };
}

test("rowToPlant: image_* columns present -> mapped verbatim to camelCase", () => {
  const plant = rowToPlant(
    baseRow({
      image_url: "https://example.test/acer.jpg",
      image_alt: "Feuillage rouge d'Acer palmatum",
      image_author: "Jane Doe",
      image_license: "CC BY-SA 4.0",
      image_source_url: "https://commons.wikimedia.org/wiki/File:Acer.jpg",
    })
  );
  assert.equal(plant.imageUrl, "https://example.test/acer.jpg");
  assert.equal(plant.imageAlt, "Feuillage rouge d'Acer palmatum");
  assert.equal(plant.imageAuthor, "Jane Doe");
  assert.equal(plant.imageLicense, "CC BY-SA 4.0");
  assert.equal(plant.imageSourceUrl, "https://commons.wikimedia.org/wiki/File:Acer.jpg");
});

test("rowToPlant: image_* columns absent (undefined, as for every current catalog row) -> all null, never fabricated", () => {
  const plant = rowToPlant(baseRow());
  assert.equal(plant.imageUrl, null);
  assert.equal(plant.imageAlt, null);
  assert.equal(plant.imageAuthor, null);
  assert.equal(plant.imageLicense, null);
  assert.equal(plant.imageSourceUrl, null);
});

test("rowToPlant: image_* columns explicitly null in the row -> stay null (not coerced to empty string or omitted)", () => {
  const plant = rowToPlant(
    baseRow({ image_url: null, image_alt: null, image_author: null, image_license: null, image_source_url: null })
  );
  assert.equal(plant.imageUrl, null);
  assert.equal(plant.imageAlt, null);
  assert.equal(plant.imageAuthor, null);
  assert.equal(plant.imageLicense, null);
  assert.equal(plant.imageSourceUrl, null);
});

test("rowToPlant: existing fields (unrelated to images) are untouched by this change", () => {
  const plant = rowToPlant(baseRow({ plant_type: "shrub", height_max_cm: 120 }));
  assert.equal(plant.plantType, "shrub");
  assert.equal(plant.heightMaxCm, 120);
  assert.equal(plant.slug, "acer-palmatum");
});

// ---------------------------------------------------------------------------
// Common-name search audit + fix regression coverage.
//
// searchPublishedPlants now delegates ALL matching (scientific name,
// common name, synonym, case/accent folding, published-only enforcement)
// to the search_published_plants Postgres RPC — see
// supabase/migrations/20260911090000_add_plant_finder_search_rpc.sql. That
// SQL logic itself was verified directly against the live Supabase project
// as part of this round's audit (not reproducible in this offline test
// suite, which has no DB credentials — same constraint the rest of this
// codebase's tests already work under):
//   - "acer" (scientific name) -> the 3 published Acer entries, unchanged
//     behavior from before this round.
//   - a plant_catalog row with common_name = 'Lavande officinale' matched
//     by query "lavande" (French common name).
//   - the same match verified case-insensitive ("LAVANDE") AND
//     accent-insensitive on BOTH sides — query "lavánde" also matched
//     "Lavande officinale", and unaccent('Érable, hortensia, fougère')
//     round-tripped to 'Erable, hortensia, fougere'.
//   - a draft-only plant ("Camellia japonica") searched by its own
//     display_name returned { rows: [], total: 0} — RLS
//     (plant_catalog_published_select) plus the RPC's own explicit
//     publication_status = 'published' filter both enforce this; nothing
//     in searchPublishedPlants's JS layer can widen it (see the
//     buildSearchRpcParams test below: its output never carries a
//     "include drafts"-shaped parameter for a caller to set).
//
// What CAN be verified offline, and is verified below: every filter
// really does reach the RPC unmodified (buildSearchRpcParams), the RPC's
// {total, rows} response is mapped/paginated correctly (total count,
// hasMore), and rows come back through the same Plant shape the rest of
// the app already relies on (rpcRowToPlant, exercised indirectly here).

function makeFakeClient(response) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return response;
    },
  };
}

function taxonRpcRow(overrides = {}) {
  return {
    id: "be44d99a-3712-4825-a5a4-7383339dbc8d",
    slug: "lavandula-angustifolia",
    entry_type: "species",
    cultivar_name: null,
    display_name: "Lavandula angustifolia",
    common_name: "Lavande officinale",
    plant_type: "shrub",
    growth_form: null,
    height_min_cm: 30,
    height_max_cm: 61,
    spread_max_cm: 91,
    sun: ["full_sun"],
    evergreen: true,
    water_need: null,
    container_suitable: null,
    edible: null,
    flowering_months: null,
    image_url: null,
    image_alt: null,
    image_author: null,
    image_license: null,
    image_source_url: null,
    canonical_name: "Lavandula angustifolia",
    family: "Lamiaceae",
    genus: "Lavandula",
    ...overrides,
  };
}

test("buildSearchRpcParams: scientific-name query passes through verbatim, no filters -> all-null except pagination", () => {
  const params = buildSearchRpcParams({ query: "Lavandula", plantType: null, sun: null, heightCategory: null, limit: 20, offset: 0 });
  assert.deepEqual(params, {
    search_query: "Lavandula",
    plant_type_filter: null,
    sun_filter: null,
    height_min: null,
    height_max: null,
    result_limit: 20,
    result_offset: 0,
  });
});

test("buildSearchRpcParams: a French common-name query is passed through unmodified — case/accent folding is the RPC's job, never done (or undone) client-side", () => {
  const params = buildSearchRpcParams({ query: "lavande", plantType: null, sun: null, heightCategory: null, limit: 20, offset: 0 });
  assert.equal(params.search_query, "lavande");
});

test("buildSearchRpcParams: an accented query is forwarded byte-for-byte, never stripped in JS (unaccent() on both sides happens in SQL)", () => {
  const params = buildSearchRpcParams({ query: "érable", plantType: null, sun: null, heightCategory: null, limit: 20, offset: 0 });
  assert.equal(params.search_query, "érable");
});

test("buildSearchRpcParams: height category maps to the same min/max bounds as before (small -> {null,100})", () => {
  const params = buildSearchRpcParams({ query: "", plantType: null, sun: null, heightCategory: "small", limit: 20, offset: 0 });
  assert.equal(params.height_min, null);
  assert.equal(params.height_max, 100);
});

test("buildSearchRpcParams: never emits any parameter shaped like a publication-status override — the published-only guarantee is the RPC's alone", () => {
  const params = buildSearchRpcParams({ query: "anything", plantType: "shrub", sun: ["full_sun"], heightCategory: "medium", limit: 20, offset: 0 });
  const keys = Object.keys(params).sort();
  assert.deepEqual(keys, ["height_max", "height_min", "plant_type_filter", "result_limit", "result_offset", "search_query", "sun_filter"]);
});

test("searchPublishedPlants: scientific name search — RPC called with the right name/args, rows mapped through rpcRowToPlant's flat taxon shape", async () => {
  const client = makeFakeClient({
    data: { total: 1, rows: [taxonRpcRow({ common_name: null })] },
    error: null,
  });
  const result = await searchPublishedPlants({ query: "Lavandula" }, client);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "search_published_plants");
  assert.equal(client.calls[0].args.search_query, "Lavandula");

  assert.equal(result.plants.length, 1);
  assert.equal(result.plants[0].displayName, "Lavandula angustifolia");
  assert.deepEqual(result.plants[0].taxon, { canonicalName: "Lavandula angustifolia", family: "Lamiaceae", genus: "Lavandula" });
});

test("searchPublishedPlants: French common-name search — a row whose common_name matched comes back with commonName populated, never fabricated by the client", async () => {
  const client = makeFakeClient({
    data: { total: 1, rows: [taxonRpcRow({ common_name: "Lavande officinale" })] },
    error: null,
  });
  const result = await searchPublishedPlants({ query: "lavande" }, client);

  assert.equal(result.plants.length, 1);
  assert.equal(result.plants[0].commonName, "Lavande officinale");
  assert.equal(result.plants[0].slug, "lavandula-angustifolia");
});

test("searchPublishedPlants: an unpublished plant never leaks — an empty RPC result (as the live draft-search audit produced) yields an empty, not fabricated, result", async () => {
  const client = makeFakeClient({ data: { total: 0, rows: [] }, error: null });
  const result = await searchPublishedPlants({ query: "Camellia japonica" }, client);

  assert.deepEqual(result.plants, []);
  assert.equal(result.total, 0);
  assert.equal(result.hasMore, false);
});

test("searchPublishedPlants: total count is read from the RPC's total, independent of how many rows came back on this page", async () => {
  const client = makeFakeClient({ data: { total: 47, rows: [taxonRpcRow()] }, error: null });
  const result = await searchPublishedPlants({ query: "e", limit: 1, offset: 0 }, client);
  assert.equal(result.total, 47);
});

test("searchPublishedPlants: pagination — hasMore is true while offset + page length is still short of total", async () => {
  const client = makeFakeClient({ data: { total: 5, rows: [taxonRpcRow(), taxonRpcRow()] }, error: null });
  const result = await searchPublishedPlants({ limit: 2, offset: 0 }, client);
  assert.equal(result.hasMore, true);
});

test("searchPublishedPlants: pagination — hasMore is false once offset + page length reaches total (last page)", async () => {
  const client = makeFakeClient({ data: { total: 5, rows: [taxonRpcRow()] }, error: null });
  const result = await searchPublishedPlants({ limit: 2, offset: 4 }, client);
  assert.equal(result.hasMore, false);
});

test("searchPublishedPlants: pagination — an offset past the last row returns an empty page with the correct (non-zero) total, never a stale/zeroed total", async () => {
  const client = makeFakeClient({ data: { total: 5, rows: [] }, error: null });
  const result = await searchPublishedPlants({ limit: 2, offset: 20 }, client);
  assert.deepEqual(result.plants, []);
  assert.equal(result.total, 5);
  assert.equal(result.hasMore, false);
});

test("searchPublishedPlants: a null/undefined RPC data payload never throws and never fabricates rows or a positive total", async () => {
  const client = makeFakeClient({ data: null, error: null });
  const result = await searchPublishedPlants({ query: "anything" }, client);
  assert.deepEqual(result.plants, []);
  assert.equal(result.total, 0);
  assert.equal(result.hasMore, false);
});

test("searchPublishedPlants: an RPC error is thrown, never swallowed into a fake empty result", async () => {
  const client = makeFakeClient({ data: null, error: { message: "boom" } });
  await assert.rejects(() => searchPublishedPlants({ query: "x" }, client));
});
