// Orchestrator for one completion lot. All I/O is injected (callApi,
// loadSnapshot) so tests run on recorded responses with no network.
//
// Per plant: proposal call -> evidence call (with pause_turn) -> grounding
// -> decision. A hard budget cap is enforced BEFORE each plant: a plant is
// only started when (spent so far + worst case for one plant) <= cap.

import { buildProposalRequest, buildEvidenceRequest, parseProposal } from "./prompts.js";
import { collectFetchedDocuments, extractFinalJson, groundEvidence } from "./grounding.js";
import { decidePlant } from "./decide.js";
import { costUsd, sumUsage } from "./anthropicClient.js";
import { WORST_CASE_PER_PLANT_USD, EXPECTED_PER_PLANT_USD, LIMITS } from "./completionConfig.js";

export function validateLot(lot) {
  const errors = [];
  if (!lot || typeof lot !== "object") return ["lot must be a JSON object"];
  if (typeof lot.lot_id !== "string" || !lot.lot_id.trim()) errors.push("lot_id is required");
  if (!Array.isArray(lot.plants) || lot.plants.length === 0) errors.push("plants must be a non-empty array");
  const seen = new Set();
  for (const [i, p] of (lot.plants || []).entries()) {
    for (const k of ["catalog_ref", "taxon_ref", "slug", "canonical_name"]) {
      if (typeof p?.[k] !== "string" || !p[k].trim()) errors.push(`plants[${i}].${k} is required`);
    }
    if (p?.slug && seen.has(p.slug)) errors.push(`plants[${i}].slug "${p.slug}" is duplicated`);
    seen.add(p?.slug);
  }
  return errors;
}

// estimateLot(lot, budgetCapUsd) — no network, no Supabase.
export function estimateLot(lot, budgetCapUsd) {
  const n = lot.plants.length;
  const maxPlantsUnderCap = Math.floor(budgetCapUsd / WORST_CASE_PER_PLANT_USD);
  return {
    plants: n,
    api_calls: n * 2,
    max_web_searches: n * LIMITS.maxSearchesPerPlant,
    max_page_fetches: n * LIMITS.maxFetchesPerPlant,
    expected_usd: { low: +(n * EXPECTED_PER_PLANT_USD.low).toFixed(2), high: +(n * EXPECTED_PER_PLANT_USD.high).toFixed(2) },
    worst_case_usd: +(n * WORST_CASE_PER_PLANT_USD).toFixed(2),
    budget_cap_usd: budgetCapUsd,
    plants_guaranteed_under_cap: Math.min(n, maxPlantsUnderCap),
  };
}

export async function runCompletion({ lot, snapshot, callApi, budgetCapUsd, log = () => {} }) {
  const results = [];
  const totalUsage = [];
  let spent = 0;
  let stoppedForBudget = false;

  for (const plant of lot.plants) {
    const existing = snapshot?.[plant.slug];
    if (snapshot && !existing) {
      results.push({ plant, skipped: "absent de plant_catalog (snapshot)" });
      continue;
    }
    if (existing && existing.publication_status !== "draft") {
      results.push({ plant, skipped: `publication_status = ${existing.publication_status} (seules les fiches draft sont complétées)` });
      continue;
    }
    if (spent + WORST_CASE_PER_PLANT_USD > budgetCapUsd) {
      stoppedForBudget = true;
      results.push({ plant, skipped: `plafond budgétaire (${spent.toFixed(2)} $ dépensés, pire cas ${WORST_CASE_PER_PLANT_USD} $ par plante, plafond ${budgetCapUsd} $)` });
      continue;
    }

    const usages = [];
    try {
      log(`→ ${plant.canonical_name}: proposition`);
      const proposalRun = await callApi(buildProposalRequest(plant));
      usages.push(proposalRun.usage);
      const proposal = parseProposal(proposalRun.content);

      log(`→ ${plant.canonical_name}: sources`);
      const evidenceRun = await callApi(buildEvidenceRequest(plant));
      usages.push(evidenceRun.usage);

      const { docs, fetchLog, searchLog } = collectFetchedDocuments(evidenceRun.content);
      const evidence = extractFinalJson(evidenceRun.content);
      const { observations, rejected } = groundEvidence(evidence, docs);
      const decision = decidePlant({ proposal, observations, existing });
      const planUsage = sumUsage(usages);
      const plantCost = costUsd(planUsage);
      spent += plantCost;
      totalUsage.push(planUsage);
      results.push({
        plant,
        proposalOk: proposal !== null,
        evidenceOk: evidence !== null,
        decision,
        observations: observations.map(({ trait, value, domain, url }) => ({ trait, value, domain, url })),
        rejected,
        fetchLog,
        searchLog,
        costUsd: +plantCost.toFixed(4),
      });
      log(`  ${decision.publishable ? "publiable" : "non publiable"} · ${plantCost.toFixed(3)} $ (total ${spent.toFixed(2)} $)`);
    } catch (error) {
      const planUsage = sumUsage(usages);
      spent += costUsd(planUsage);
      totalUsage.push(planUsage);
      results.push({ plant, error: error.message, costUsd: +costUsd(planUsage).toFixed(4) });
      log(`  erreur : ${error.message}`);
      if (error.status === 401 || error.status === 403) break; // auth problem: never keep spending attempts
    }
  }

  const usage = sumUsage(totalUsage);
  return { results, spend: { usd: +costUsd(usage).toFixed(4), usage }, stoppedForBudget };
}
