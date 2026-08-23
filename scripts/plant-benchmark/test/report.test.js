import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeReportMd } from "../src/report.js";

function mkPlant(inputName, inputType, perenualReason) {
  return {
    input_name: inputName,
    input_type: inputType,
    taxonomy: {
      accepted_name: inputName, accepted_taxon_id: "1", taxonomic_rank: "SPECIES",
      family: "F", genus: "G", taxonomic_status: "ACCEPTED", canonical_name: inputName,
      synonyms: [], source_taxon_id: "1",
    },
    horticultural_identity: { cultivar: null, variety: null, hybrid: null },
    traits_scope: "full",
    providers: {
      wcvp: {
        taxonomic_parent: inputName, not_found: false, selection_reason: "exact_scientific_match",
        queried_usage: null, accepted_usage: null, candidates: [], lookup_strategy: "exact", error: null,
      },
      perenual: {
        status: perenualReason, selection_reason: perenualReason, candidate_count: 0, candidates: [],
        record: null, wcvp_match_type: "not_found",
        error: perenualReason === "plan_restricted" ? { provider: "perenual", message: "plan_restricted" } : null,
      },
      trefle: {
        status: "exact_scientific_match", selection_reason: "exact_scientific_match", candidate_count: 1,
        candidates: [], record: { scientific_name: inputName }, provenance: null,
        wcvp_match_type: "exact_accepted_match", error: null,
      },
    },
    traits: {},
  };
}

test("report #6: unresolved_under_plan is shown separately from plan_restricted and not_found, never conflated", () => {
  const normalized = [
    mkPlant("Hydrangea paniculata 'Bobo'", "cultivar", "unresolved_under_plan"),
    mkPlant("Acer palmatum", "species", "plan_restricted"),
    mkPlant("Betula pendula", "species", "not_found"),
  ];

  const dir = mkdtempSync(path.join(os.tmpdir(), "plant-benchmark-report-test-"));
  const outPath = path.join(dir, "report.md");
  try {
    writeReportMd(normalized, [], { hasPerenualKey: true, hasTrefleKey: true, perenualAccessTier: "personal" }, outPath);
    const md = readFileSync(outPath, "utf8");

    // Each state is counted under its own distinct label — never merged.
    assert.ok(md.includes("non résolu sous le plan (`unresolved_under_plan`) : 1"));
    assert.ok(md.includes("restriction de plan (`plan_restricted`) : 1"));

    // The methodological explanation is present and distinguishes the two.
    assert.ok(md.includes("unresolved_under_plan"));
    assert.ok(md.includes("PERENUAL_ACCESS_TIER"));
    assert.ok(md.includes("personal"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report: API quality uses neutral 'provider HTTP/error event(s)' wording and splits plan restrictions from provider/network errors", () => {
  const normalized = [
    mkPlant("Acer palmatum", "species", "plan_restricted"),
    mkPlant("Betula pendula", "species", "provider_error"),
  ];
  const errors = [
    { provider: "perenual", status: "error", http_status: 429, message: "plan_restricted", retrieved_at: "2026-01-01T00:00:00.000Z" },
    { provider: "perenual", status: "error", http_status: 500, message: "http_error", retrieved_at: "2026-01-01T00:00:00.000Z" },
  ];

  const dir = mkdtempSync(path.join(os.tmpdir(), "plant-benchmark-report-test-"));
  const outPath = path.join(dir, "report.md");
  try {
    writeReportMd(normalized, errors, { hasPerenualKey: true, hasTrefleKey: true, perenualAccessTier: null }, outPath);
    const md = readFileSync(outPath, "utf8");

    // Neutral wording used; the old misleading "erreur(s) réseau/HTTP"
    // label for the raw total is never used again.
    assert.ok(md.includes("provider HTTP/error event(s)"));
    assert.ok(!md.includes("erreur(s) réseau/HTTP enregistrée"));

    // The 2 Perenual events are split: 1 plan restriction, 1 real error —
    // never merged into one undifferentiated "network error" bucket.
    assert.ok(md.includes("2 provider HTTP/error event(s) (1 erreur(s) fournisseur/réseau, 1 restriction(s) de plan)"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report: configured access tier is surfaced verbatim in the executive summary", () => {
  const normalized = [mkPlant("Acer palmatum", "species", "exact_scientific_match")];
  const dir = mkdtempSync(path.join(os.tmpdir(), "plant-benchmark-report-test-"));
  const outPath = path.join(dir, "report.md");
  try {
    writeReportMd(normalized, [], { hasPerenualKey: true, hasTrefleKey: true, perenualAccessTier: null }, outPath);
    const md = readFileSync(outPath, "utf8");
    assert.ok(md.includes("non défini (aucune reclassification unresolved_under_plan n'est jamais appliquée dans ce cas)"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
