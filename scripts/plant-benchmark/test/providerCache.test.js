import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { createCachedFetch, cacheKeyForUrl } from "../src/providerCache.js";

function tmpCacheDir() {
  return mkdtempSync(path.join(os.tmpdir(), "provider-cache-test-"));
}

// A minimal fake fetchImpl: returns queued results in order, and counts
// how many times it was actually invoked (network calls this test must
// prove were avoided on a cache hit).
function fakeFetch(results) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    const next = results[calls.length - 1];
    if (!next) throw new Error("fakeFetch called more times than results were queued");
    return next;
  };
  fn.calls = calls;
  return fn;
}

const OK_RESULT = { ok: true, status: 200, data: { hello: "world" }, url: "https://example.test/species?name=Acer" };
const RATE_LIMITED_RESULT = { ok: false, status: 429, error: "rate_limited", url: "https://example.test/species?name=Acer" };

test("A: first successful fetch writes a cache file to disk", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const fetch1 = fakeFetch([OK_RESULT]);
    const cached = createCachedFetch({ cacheDir, fetchImpl: fetch1 });

    const result = await cached("https://example.test/species?name=Acer&key=SECRET", { providerName: "wcvp" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { hello: "world" });
    assert.equal(fetch1.calls.length, 1);

    const files = readdirSync(path.join(cacheDir, "wcvp"));
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith(".json"));
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("B: second run hits the cache — zero network calls", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const fetch1 = fakeFetch([OK_RESULT]);
    const cachedRun1 = createCachedFetch({ cacheDir, fetchImpl: fetch1 });
    const url = "https://example.test/species?name=Acer&key=SECRET";
    await cachedRun1(url, { providerName: "wcvp" });
    assert.equal(fetch1.calls.length, 1);

    // A brand-new cached-fetch instance (simulating a fresh CLI process /
    // rerun), backed by a fetchImpl that would throw if ever called.
    const fetch2 = fakeFetch([]);
    const cachedRun2 = createCachedFetch({ cacheDir, fetchImpl: fetch2 });
    const result = await cachedRun2(url, { providerName: "wcvp" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { hello: "world" });
    assert.equal(result.cached, true);
    assert.equal(fetch2.calls.length, 0, "a cache hit must never invoke the network fetchImpl");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("C: --refresh forces a real network call even when a valid cache entry exists", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species?name=Acer&key=SECRET";
    const fetch1 = fakeFetch([OK_RESULT]);
    await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "wcvp" });
    assert.equal(fetch1.calls.length, 1);

    const freshResult = { ok: true, status: 200, data: { hello: "refreshed" }, url };
    const fetch2 = fakeFetch([freshResult]);
    const result = await createCachedFetch({ cacheDir, refresh: true, fetchImpl: fetch2 })(url, { providerName: "wcvp" });

    assert.equal(fetch2.calls.length, 1, "--refresh must call the network even though a cache entry exists");
    assert.deepEqual(result.data, { hello: "refreshed" });
    assert.equal(result.cached, false);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("D: --refresh network call returns 429 after a prior success — the old successful cache is preserved and returned", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species?name=Acer&key=SECRET";
    const fetch1 = fakeFetch([OK_RESULT]);
    await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "wcvp" });

    const fetch2 = fakeFetch([RATE_LIMITED_RESULT]);
    const result = await createCachedFetch({ cacheDir, refresh: true, fetchImpl: fetch2 })(url, { providerName: "wcvp" });

    // The old successful data is what the caller gets back — resilience is
    // the entire point of this cache (real regression: a batch-12 rebuild
    // burned Perenual's daily quota mid-run and lost the already-fetched
    // data for species processed earlier in the same run).
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { hello: "world" });
    assert.equal(result.cached, true);
    assert.equal(result.stale_fallback, true);

    // The cache file on disk is untouched — still the original success,
    // the 429 was never written over it.
    const rerun = await createCachedFetch({ cacheDir, fetchImpl: fakeFetch([]) })(url, { providerName: "wcvp" });
    assert.deepEqual(rerun.data, { hello: "world" });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("E: a first-ever call that returns 429 never creates a success cache entry", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species?name=Acer&key=SECRET";
    const fetch1 = fakeFetch([RATE_LIMITED_RESULT]);
    const result = await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "wcvp" });

    assert.equal(result.ok, false);
    assert.equal(result.error, "rate_limited");

    const providerDir = path.join(cacheDir, "wcvp");
    let files = [];
    try { files = readdirSync(providerDir); } catch { /* directory may not even exist — also correct */ }
    assert.equal(files.length, 0, "a failed fetch must never create a cache file");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("F: an invalid/corrupt cache JSON file falls back to a clean network fetch (never crashes)", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species?name=Acer&key=SECRET";
    const key = cacheKeyForUrl(url);
    const providerDir = path.join(cacheDir, "wcvp");
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(path.join(providerDir, `${key}.json`), "{ not valid json !!", "utf8");

    const fetch1 = fakeFetch([OK_RESULT]);
    const result = await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "wcvp" });

    assert.equal(fetch1.calls.length, 1, "corrupt cache must fall back to a real network call, not crash");
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { hello: "world" });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

// G: the whole point of the cache — an old, already-cached raw Perenual
// response, combined with TODAY's selections.js code (not the code that
// was live when the response was first cached), must produce the CORRECT,
// current selection behavior with zero new network calls. Mirrors the
// real batch-12 regression: cached raw plant_type="Shrub" + the current
// (post batch-12 trust-policy) selections.js must yield an observation but
// NO plant_type selection — reusing the actual queryPerenual/normalization/
// selections pipeline, not a hand-rolled shortcut.
test("G: cached raw Perenual data + current selections.js code -> correct (no plant_type auto-selection), zero new network calls", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const { queryPerenual } = await import("../src/providers/perenual.js");
    const { buildObservations } = await import("../../plant-ingestion/src/provenance.js");
    const { applyDeterministicNormalizations } = await import("../../plant-ingestion/src/normalization.js");
    const { proposeSelections } = await import("../../plant-ingestion/src/selections.js");

    // Perenual's search endpoint nests candidates under `.data` (an array);
    // its species/details endpoint returns the species object directly at
    // the top level — mapPerenualDetailToTraits reads `d.type` etc. off
    // detailResult.data with no extra nesting.
    const searchData = { data: [{ id: 42, scientific_name: ["Alcea rosea"], common_name: "Hollyhock" }] };
    const detailData = { id: 42, type: "Shrub", scientific_name: ["Alcea rosea"] };

    // Seed the cache directly (simulating "already retrieved before the
    // Perenual quota ran out") — no queryPerenual call happens here. The
    // seed URLs must match EXACTLY what queryPerenual itself constructs
    // (same BASE, same apiKey, same encodeURIComponent) — the cache key
    // is derived from the request URL (redacted), so it is exactly as
    // sensitive to this as the real cache would be on a real rerun.
    const apiKey = "fake-key-not-real";
    const searchUrl = `https://perenual.com/api/v2/species-list?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent("Alcea rosea")}`;
    const detailUrl = `https://perenual.com/api/v2/species/details/42?key=${encodeURIComponent(apiKey)}`;
    const seedFetch = fakeFetch([
      { ok: true, status: 200, data: searchData, url: searchUrl },
      { ok: true, status: 200, data: detailData, url: detailUrl },
    ]);
    const seedCached = createCachedFetch({ cacheDir, fetchImpl: seedFetch });
    await seedCached(searchUrl, { providerName: "perenual" });
    await seedCached(detailUrl, { providerName: "perenual" });

    // "Rerun" with a fetchImpl that throws on any call — proves this whole
    // query goes through the cache, zero network.
    const noNetwork = async () => {
      throw new Error("network must never be called on a full cache hit");
    };
    const rerunCached = createCachedFetch({ cacheDir, fetchImpl: noNetwork });

    const result = await queryPerenual({ inputName: "Alcea rosea", rawRoot: cacheDir, apiKey: "fake-key-not-real", fetchImpl: rerunCached });
    assert.equal(result.status, "ok");

    // Real pipeline function (provenance.js), exactly as bundle.js uses it
    // — never a hand-built observation shape.
    const rawObservations = buildObservations({ provider: "perenual", catalogRef: "alcea_rosea_species", sourceRecordRef: "sr1", result });
    const plantTypeObs = rawObservations.find((o) => o.trait === "plant_type");
    assert.ok(plantTypeObs, "the cached raw response must still produce a plant_type OBSERVATION");
    assert.equal(plantTypeObs.raw_value, "Shrub");

    const { observations } = applyDeterministicNormalizations(rawObservations);
    const { selections } = proposeSelections({ observations });

    const normalizedPlantType = observations.find((o) => o.trait === "plant_type");
    assert.equal(normalizedPlantType.normalized_value, "shrub", "the raw cached value must still be normalized by TODAY's crosswalk");
    assert.ok(!selections.some((s) => s.trait === "plant_type"), "TODAY's trust policy (no single-provider plant_type auto-selection) must apply, even though the raw data predates that code change");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("H: retrieved_at is stable across a cache hit — never fabricated fresh on every read", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species?name=Acer&key=SECRET";
    const fetch1 = fakeFetch([OK_RESULT]);
    const first = await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "wcvp" });
    assert.ok(first.retrieved_at);

    // A short real delay so a bug that fabricates "now" on every read
    // would be observable as a changed timestamp.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await createCachedFetch({ cacheDir, fetchImpl: fakeFetch([]) })(url, { providerName: "wcvp" });
    assert.equal(second.cached, true);
    assert.equal(second.retrieved_at, first.retrieved_at, "retrieved_at must be the ORIGINAL fetch time, unchanged by a cache read");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("I: no secret (API key) is ever written into a cache file, even though the real request URL carried one", async () => {
  const cacheDir = tmpCacheDir();
  try {
    const url = "https://example.test/species-list?key=TOP_SECRET_VALUE_123&q=Acer";
    const fetch1 = fakeFetch([{ ok: true, status: 200, data: { hello: "world" }, url }]);
    await createCachedFetch({ cacheDir, fetchImpl: fetch1 })(url, { providerName: "perenual" });

    const files = readdirSync(path.join(cacheDir, "perenual"));
    assert.equal(files.length, 1);
    const raw = readFileSync(path.join(cacheDir, "perenual", files[0]), "utf8");
    assert.ok(!raw.includes("TOP_SECRET_VALUE_123"), "the cache file must never contain the real API key");
    assert.ok(raw.includes("***"), "the persisted url should show the redacted placeholder");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("cache key derivation ignores the secret query param — same key regardless of the key/token value", () => {
  const a = cacheKeyForUrl("https://example.test/species-list?key=AAA&q=Acer");
  const b = cacheKeyForUrl("https://example.test/species-list?key=BBB&q=Acer");
  assert.equal(a, b);
});
