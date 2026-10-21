import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCompletion, estimateLot, validateLot } from "../../src/completion/runCompletion.js";
import { buildEditorialEntries, buildCommonNamesBatch, buildCatalogMap, buildPublishSql, buildSiteStats } from "../../src/completion/emit.js";
import { buildProposalRequest, buildEvidenceRequest } from "../../src/completion/prompts.js";
import { costUsd, runWithPauseTurn, postMessages } from "../../src/completion/anthropicClient.js";
import { WORST_CASE_PER_PLANT_USD } from "../../src/completion/completionConfig.js";
import { validateEditorialInput } from "../../src/editorial/validateEditorialInput.js";
import { buildEditorialPlan } from "../../src/editorial/buildEditorialPlan.js";
import { validateCommonNamesBatch } from "../../src/editorial/validateCommonNamesBatch.js";
import { buildCatalogSlugMap } from "../../src/editorial/checkEditorialAgainstDb.js";
import { main, parseArgs } from "../../src/completionCli.js";
import { PLANT, fakeCallApi, DRAFT_EMPTY_ROW, USAGE_PROPOSAL, USAGE_EVIDENCE } from "./fixtures.js";

const LOT = { lot_id: "test-lot", plants: [PLANT] };
const SNAPSHOT = { [PLANT.slug]: DRAFT_EMPTY_ROW };

test("request shapes: claude-sonnet-5-5, no prefill, thinking between_tools, allowlisted web tools", () => {
  const proposal = buildProposalRequest(PLANT);
  assert.equal(proposal.model, "claude-sonnet-5-5");
  assert.deepEqual(proposal.thinking, { type: "between_tools" });
  assert.equal(proposal.output_config.format.type, "json_schema");
  assert.equal(proposal.messages.at(-1).role, "user");
  assert.equal(proposal.tools, undefined);

  const evidence = buildEvidenceRequest(PLANT);
  assert.equal(evidence.model, "claude-sonnet-5-5");
  assert.deepEqual(evidence.thinking, { type: "between_tools" });
  assert.equal(evidence.messages.at(-1).role, "user");
  assert.deepEqual(evidence.tools.map((t) => t.type), ["web_search_20250305", "web_fetch_20250910"]);
  for (const tool of evidence.tools) assert.ok(tool.allowed_domains.includes("rhs.org.uk") && tool.max_uses <= 6);
  assert.ok(!JSON.stringify(evidence).includes("Testier"), "the evidence call never sees the AI proposal");
});

test("runCompletion end to end on recorded responses: decisions, cost, logs", async () => {
  const calls = [];
  const run = await runCompletion({ lot: LOT, snapshot: SNAPSHOT, callApi: fakeCallApi({ calls }), budgetCapUsd: 8 });
  assert.equal(calls.length, 2);
  const r = run.results[0];
  assert.equal(r.decision.publishable, true);
  const expected = costUsd({ ...USAGE_PROPOSAL }) + costUsd({ input_tokens: USAGE_EVIDENCE.input_tokens, output_tokens: USAGE_EVIDENCE.output_tokens, web_search_requests: 3 });
  assert.ok(Math.abs(run.spend.usd - expected) < 1e-6);
  assert.equal(run.spend.usage.web_search_requests, 3);
});

test("budget cap: no plant is started if it could exceed the cap", async () => {
  const calls = [];
  const lot = { lot_id: "x", plants: [PLANT, { ...PLANT, slug: "testus-b", catalog_ref: "testus_b_species", taxon_ref: "testus_b" }] };
  const snapshot = { ...SNAPSHOT, "testus-b": { ...DRAFT_EMPTY_ROW, slug: "testus-b" } };
  const run = await runCompletion({ lot, snapshot, callApi: fakeCallApi({ calls }), budgetCapUsd: WORST_CASE_PER_PLANT_USD + 0.01 });
  assert.equal(calls.length, 2, "only the first plant ran");
  assert.equal(run.stoppedForBudget, true);
  assert.match(run.results[1].skipped, /plafond/);
});

test("non-draft or missing rows are skipped without any API call", async () => {
  const calls = [];
  const run = await runCompletion({ lot: LOT, snapshot: { [PLANT.slug]: { ...DRAFT_EMPTY_ROW, publication_status: "published" } }, callApi: fakeCallApi({ calls }), budgetCapUsd: 8 });
  assert.equal(calls.length, 0);
  assert.match(run.results[0].skipped, /published/);
  const run2 = await runCompletion({ lot: LOT, snapshot: {}, callApi: fakeCallApi({ calls }), budgetCapUsd: 8 });
  assert.match(run2.results[0].skipped, /absent/);
});

test("emitted files are accepted by the existing editorial / common-names tooling", async () => {
  const run = await runCompletion({ lot: LOT, snapshot: SNAPSHOT, callApi: fakeCallApi(), budgetCapUsd: 8 });
  const generatedAt = "2026-10-21T12:00:00.000Z";
  const entries = buildEditorialEntries(run.results, { generatedAt });
  assert.equal(entries.length, 8);
  for (const e of entries) assert.deepEqual(validateEditorialInput(e), [], `${e.trait}`);
  const plan = buildEditorialPlan(entries);
  assert.equal(plan.editorial_observations.length, 8);
  const sun = entries.find((e) => e.trait === "sun");
  assert.equal(sun.source.publisher, "Royal Horticultural Society (RHS)", "institutional source is the primary one");
  assert.match(sun.review.note, /corroboration: Missouri Botanical Garden — Plant Finder \| .* \| https:\/\/www\.missouribotanicalgarden\.org\//);
  assert.ok(!/Sunlight:/.test(JSON.stringify(entries)), "no page passage is copied into the output");

  // only one French-name site (INPN) -> no name row is emitted
  const names = buildCommonNamesBatch(run.results, { generatedAt, lotId: "test-lot" });
  assert.equal(names.rows.length, 0);

  const map = buildCatalogSlugMap(buildCatalogMap(LOT.plants));
  assert.equal(map.get(PLANT.catalog_ref), PLANT.slug);

  const sql = buildPublishSql(run.results, { lotId: "test-lot" });
  assert.match(sql, /\('testus-exemplaris'\)/);
  assert.match(sql, /expected constant int := 1/);
  assert.match(sql, /publication_status = 'draft'/);
});

test("site stats report fetch blocking per site", async () => {
  const run = await runCompletion({
    lot: LOT,
    snapshot: SNAPSHOT,
    callApi: fakeCallApi({ evidenceOptions: { blocked: [{ url: "https://www.gardenersworld.com/plants/testus/", error_code: "url_not_allowed" }] } }),
    budgetCapUsd: 8,
  });
  const stats = buildSiteStats(run.results);
  assert.equal(stats["gardenersworld.com"].fetch_blocked, 1);
  assert.equal(stats["gardenersworld.com"].fetch_block_rate, 100);
  assert.deepEqual(stats["gardenersworld.com"].blocked_codes, { url_not_allowed: 1 });
  assert.equal(stats["rhs.org.uk"].fetch_block_rate, 0);
});

test("estimate and lot validation never touch the network", () => {
  const lot = JSON.parse(readFileSync(new URL("../../completion-lot-1.json", import.meta.url), "utf8"));
  assert.deepEqual(validateLot(lot), []);
  assert.equal(lot.plants.length, 15);
  const e = estimateLot(lot, 8);
  assert.equal(e.api_calls, 30);
  assert.ok(e.expected_usd.high <= 8);
  assert.ok(validateLot({ lot_id: "", plants: [] }).length >= 2);
});

test("CLI: --estimate makes no call; --budget-usd cannot exceed the 8 $ hard cap", async () => {
  assert.throws(() => parseArgs(["--input", "x.json", "--execute", "--budget-usd", "20"]), /hard cap/);
  assert.throws(() => parseArgs(["--input", "x.json", "--execute", "--estimate"]), /mutually exclusive/);
  const dir = mkdtempSync(path.join(tmpdir(), "completion-"));
  try {
    const lotFile = path.join(dir, "lot.json");
    writeFileSync(lotFile, JSON.stringify(LOT));
    const res = await main(["--input", lotFile], {
      callApi: () => { throw new Error("network must not be used in estimate mode"); },
      getAnthropicConfig: () => { throw new Error("no key lookup in estimate mode"); },
    });
    assert.equal(res.mode, "estimate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --execute with recorded responses writes all files and never writes to Supabase", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "completion-"));
  const writes = [];
  const readOnlyClient = {
    from(table) {
      const q = {
        select() { return q; },
        in() { return q; },
        eq() { return q; },
        insert() { writes.push(table); return q; },
        update() { writes.push(table); return q; },
        delete() { writes.push(table); return q; },
        then(resolve) {
          resolve(table === "plant_catalog" ? { data: [DRAFT_EMPTY_ROW], error: null } : { data: [], error: null });
        },
      };
      return q;
    },
  };
  try {
    const lotFile = path.join(dir, "lot.json");
    writeFileSync(lotFile, JSON.stringify(LOT));
    const res = await main(["--input", lotFile, "--execute", "--out", path.join(dir, "out")], {
      callApi: fakeCallApi(),
      getAnthropicConfig: () => ({ apiKey: "test-key", hasApiKey: true }),
      getSupabaseConfig: () => ({ url: "https://example.supabase.co", serviceRoleKey: "x", hasUrl: true, hasServiceRoleKey: true }),
      createClient: () => readOnlyClient,
      now: () => new Date("2026-10-21T12:00:00Z"),
      log: () => {},
    });
    assert.equal(res.mode, "execute");
    assert.deepEqual(writes, [], "the snapshot is read-only");
    const report = JSON.parse(readFileSync(path.join(dir, "out", "report.json"), "utf8"));
    assert.equal(report.summary.publishable, 1);
    assert.deepEqual(report.output_validation, { editorial_errors: [], common_names_errors: [] });
    assert.ok(!readFileSync(path.join(dir, "out", "report.json"), "utf8").includes("test-key"), "the API key is never written");
    for (const f of ["editorial-input.json", "common-names.json", "catalog-map.json", "report.md", "publish-candidates.sql"]) readFileSync(path.join(dir, "out", f), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anthropicClient: retries a 529 then succeeds; continues a pause_turn; never puts the key in errors", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return { ok: false, status: 529, json: async () => ({ error: { type: "overloaded_error", message: "busy" } }) };
    if (n === 2) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "a" }], stop_reason: "pause_turn", usage: { input_tokens: 10, output_tokens: 1 } }) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "b" }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 2 } }) };
  };
  const run = await runWithPauseTurn({ model: "m", messages: [{ role: "user", content: "q" }] }, { apiKey: "secret-key", fetchImpl, sleep: async () => {} });
  assert.deepEqual(run.content.map((b) => b.text), ["a", "b"]);
  assert.equal(run.usage.input_tokens, 30);

  const denied = async () => ({ ok: false, status: 401, json: async () => ({ error: { type: "authentication_error", message: "invalid x-api-key" } }) });
  await assert.rejects(postMessages({}, { apiKey: "secret-key", fetchImpl: denied, sleep: async () => {} }), (err) => err.status === 401 && !err.message.includes("secret-key"));
});
