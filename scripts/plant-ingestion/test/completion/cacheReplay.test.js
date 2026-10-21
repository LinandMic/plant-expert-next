import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cachedCallApi, readCacheEntry, requestHash } from "../../src/completion/responseCache.js";
import { buildEvidenceRequest } from "../../src/completion/prompts.js";
import { LIMITS, SOURCE_DOMAINS } from "../../src/completion/completionConfig.js";
import { parsePlantType } from "../../src/completion/textParsers.js";
import { main } from "../../src/completionCli.js";
import { PLANT, fakeCallApi, DRAFT_EMPTY_ROW } from "./fixtures.js";

function tmp() {
  return mkdtempSync(path.join(tmpdir(), "completion-cache-"));
}

test("execute mode: a live call is cached, an identical request is then reused without calling", async () => {
  const dir = tmp();
  try {
    let live = 0;
    const call = cachedCallApi({ cacheDir: dir, liveCallApi: async () => { live += 1; return { content: [{ type: "text", text: "x" }], usage: { input_tokens: 10, output_tokens: 1 }, stopReason: "end_turn" }; }, mode: "execute" });
    const body = buildEvidenceRequest(PLANT);
    const first = await call(body, { slug: PLANT.slug, kind: "evidence" });
    const second = await call(body, { slug: PLANT.slug, kind: "evidence" });
    assert.equal(live, 1);
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.equal(readCacheEntry(dir, PLANT.slug, "evidence").request_hash, requestHash(body));
    // a changed request (prompt, tools, limits) is paid again, never silently reused
    await call({ ...body, max_tokens: body.max_tokens + 1 }, { slug: PLANT.slug, kind: "evidence" });
    assert.equal(live, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replay mode never calls the API: cache hit is reused (even with a changed request, flagged), cache miss is an error", async () => {
  const dir = tmp();
  try {
    const exec = cachedCallApi({ cacheDir: dir, liveCallApi: async () => ({ content: [], usage: {}, stopReason: "end_turn" }), mode: "execute" });
    await exec({ a: 1 }, { slug: "s", kind: "proposal" });
    const replay = cachedCallApi({ cacheDir: dir, liveCallApi: async () => { throw new Error("must never be called"); }, mode: "replay" });
    const hit = await replay({ a: 2 }, { slug: "s", kind: "proposal" });
    assert.equal(hit.fromCache, true);
    assert.equal(hit.requestChanged, true);
    await assert.rejects(replay({ a: 1 }, { slug: "other", kind: "proposal" }), (e) => e.code === "CACHE_MISS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --execute fills the cache + snapshot; --replay re-decides with no API, no key, no Supabase, zero spend", async () => {
  const dir = tmp();
  try {
    const lotFile = path.join(dir, "lot.json");
    writeFileSync(lotFile, JSON.stringify({ lot_id: "t", plants: [PLANT] }));
    const out = path.join(dir, "out");
    const client = { from(table) { const q = { select: () => q, in: () => q, eq: () => q, then: (r) => r(table === "plant_catalog" ? { data: [DRAFT_EMPTY_ROW], error: null } : { data: [], error: null }) }; return q; } };
    const execDeps = {
      callApi: fakeCallApi(),
      getAnthropicConfig: () => ({ apiKey: "k", hasApiKey: true }),
      getSupabaseConfig: () => ({ url: "u", serviceRoleKey: "s", hasUrl: true, hasServiceRoleKey: true }),
      createClient: () => client,
      log: () => {},
    };
    const exec = await main(["--input", lotFile, "--execute", "--out", out], execDeps);
    assert.ok(exec.report.spend.usd > 0);
    assert.ok(existsSync(path.join(out, "cache", "snapshot.json")));
    assert.ok(existsSync(path.join(out, "cache", PLANT.slug, "evidence.json")));

    const replay = await main(["--input", lotFile, "--replay", "--out", out], {
      callApi: () => { throw new Error("no API in replay"); },
      getAnthropicConfig: () => { throw new Error("no key lookup in replay"); },
      getSupabaseConfig: () => { throw new Error("no Supabase in replay"); },
      log: () => {},
    });
    assert.equal(replay.mode, "replay");
    assert.equal(replay.report.spend.usd, 0);
    assert.ok(replay.report.spend.reused_from_cache_usd_if_paid > 0);
    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8"));
    assert.equal(report.plants[0].from_cache, true);
    assert.ok(report.plants[0].source_values.some((v) => v.trait === "height" && v.domain === "rhs.org.uk" && v.value.max_cm === 400), "parsed value of each source is in report.json");
    assert.ok(!JSON.stringify(report.plants[0].source_values).includes("Ultimate height"), "never the passage itself");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cost reduction limits and site list", () => {
  assert.equal(LIMITS.maxFetchesPerPlant, 4);
  assert.equal(LIMITS.maxSearchesPerPlant, 4);
  assert.equal(LIMITS.maxContentTokensPerFetch, 5000);
  assert.equal(SOURCE_DOMAINS["tela-botanica.org"], undefined, "tela-botanica.org removed (100 % blocked in lot 1)");
  const fetchTool = buildEvidenceRequest(PLANT).tools.find((t) => t.name === "web_fetch");
  assert.equal(fetchTool.max_content_tokens, 5000);
  assert.ok(!fetchTool.allowed_domains.includes("tela-botanica.org"));
});

test("'conifer' maps to tree + shrub (the AI and the other sources decide)", () => {
  assert.deepEqual(parsePlantType("Conifer"), ["tree", "shrub"]);
  assert.deepEqual(parsePlantType("Coniferous evergreen"), ["tree", "shrub"]);
  assert.deepEqual(parsePlantType("Conifère"), ["tree", "shrub"]);
});

test("site list after lot 1: 4 sites added, umn/uconn not added", async () => {
  const { sourceInfoForUrl } = await import("../../src/completion/completionConfig.js");
  assert.equal(sourceInfoForUrl("https://landscapeplants.oregonstate.edu/plants/x").institutional, true);
  assert.equal(sourceInfoForUrl("https://hort.extension.wisc.edu/articles/x/").institutional, true);
  const pfaf = sourceInfoForUrl("https://pfaf.org/user/Plant.aspx?LatinName=X");
  assert.equal(pfaf.institutional, false);
  assert.equal(pfaf.traits, true);
  const wiki = sourceInfoForUrl("https://fr.wikipedia.org/wiki/X");
  assert.equal(wiki.traits, false);
  assert.equal(wiki.names_fr, true);
  assert.equal(sourceInfoForUrl("https://en.wikipedia.org/wiki/X"), null, "only the French Wikipedia");
  assert.equal(sourceInfoForUrl("https://extension.umn.edu/x"), null);
  assert.equal(sourceInfoForUrl("https://hort.uconn.edu/x"), null);
});
