// Request builders for the two model calls of the completion step.
//
// 1. Proposal — no tools, JSON schema output: the model's own proposed
//    values. Used ONLY as the third opinion in decide.js, never recorded
//    as a source.
// 2. Evidence — web search + web fetch restricted to SOURCE_DOMAINS. The
//    model only reports which fetched page says what, with a short
//    VERBATIM passage per trait; grounding.js then re-checks every passage
//    against the fetched page text and parses the value itself. The
//    evidence call deliberately never sees the proposal (independence).
//
// No assistant prefill (rejected by claude-sonnet-5-5); thinking is
// between_tools, as in the app's own routes.

import { SUN_VALUES, PLANT_TYPE_VALUES, WATER_NEED_VALUES } from "../editorial/editorialVocab.js";
import { ALLOWED_DOMAINS, COMPLETION_MODEL, LIMITS } from "./completionConfig.js";

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

export const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plant_type", "sun", "height_min_cm", "height_max_cm", "spread_max_cm", "evergreen", "water_need", "flowering_months", "common_name_fr"],
  properties: {
    plant_type: nullable({ type: "string", enum: PLANT_TYPE_VALUES }),
    sun: { type: "array", items: { type: "string", enum: SUN_VALUES } },
    height_min_cm: nullable({ type: "number" }),
    height_max_cm: nullable({ type: "number" }),
    spread_max_cm: nullable({ type: "number" }),
    evergreen: nullable({ type: "boolean" }),
    water_need: nullable({ type: "string", enum: WATER_NEED_VALUES }),
    flowering_months: { type: "array", items: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } },
    common_name_fr: nullable({ type: "string" }),
  },
};

const PROPOSAL_SYSTEM = `You provide reference horticultural data for a garden-plant catalog used in Belgium and France.
Give values for the species as commonly grown in gardens (not for a particular cultivar), at maturity, in temperate western-European gardens.
Use null (or an empty array) whenever you are not confident — an empty answer is always better than a guess.
Vocabularies:
- plant_type: ${PLANT_TYPE_VALUES.join(", ")}
- sun: any of ${SUN_VALUES.join(", ")} (all exposures the plant tolerates well)
- water_need: low (drought tolerant once established), moderate (regular), high (needs constantly moist soil)
- heights and spread in centimetres; flowering_months as month numbers 1-12 (empty for ferns and grasses)
- common_name_fr: the most widely used French common name, as written in French.`;

export function buildProposalRequest(plant) {
  return {
    model: COMPLETION_MODEL,
    max_tokens: LIMITS.proposalMaxTokens,
    thinking: { type: "between_tools" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
    system: PROPOSAL_SYSTEM,
    messages: [{ role: "user", content: `Species (accepted botanical name): ${plant.canonical_name}` }],
  };
}

const EVIDENCE_SYSTEM = `You collect evidence about one plant species from authoritative horticultural and botanical web pages. You never answer from memory.
Steps:
1. Use web_search to find this exact species' own page on the allowed sites. Prefer: rhs.org.uk, landscapeplants.oregonstate.edu, hort.extension.wisc.edu, plants.ces.ncsu.edu, missouribotanicalgarden.org, then pfaf.org and gardenersworld.com. For the French common name use inpn.mnhn.fr and fr.wikipedia.org (never use Wikipedia for any other trait).
2. Use web_fetch to read the species' own page (never a cultivar, a hybrid or another species page) on two or three DIFFERENT sites, at most ${LIMITS.maxFetchesPerPlant} pages in total. Stop fetching as soon as two different sites cover type, height, spread and sun. If a site refuses a fetch, do not retry it: move to another site.
3. From each fetched page, copy for each trait the SHORT passage (at most 200 characters) that states it, EXACTLY as written on the page (no paraphrase, no translation, no unit conversion). If a page does not state a trait, leave it out. Never fill a trait from another page or from memory.
Traits: plant_type (e.g. "Type: Deciduous shrub"), height, spread, sun, evergreen (evergreen/deciduous), water_need (water/moisture), flowering_months (bloom time / flowering season), common_name_fr (only from the French-name sites: the passage containing the French common name).
Final answer: only one JSON object inside a \`\`\`json block, with this shape:
{"sources":[{"url":"<exact fetched URL>","traits":{"plant_type":"...","height":"...","spread":"...","sun":"...","evergreen":"...","water_need":"...","flowering_months":"...","common_name_fr":"..."},"common_name_fr":"<the French name exactly as written, or null>"}]}`;

export function buildEvidenceRequest(plant) {
  return {
    model: COMPLETION_MODEL,
    max_tokens: LIMITS.evidenceMaxTokens,
    thinking: { type: "between_tools" },
    output_config: { effort: "medium" },
    system: EVIDENCE_SYSTEM,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: LIMITS.maxSearchesPerPlant, allowed_domains: ALLOWED_DOMAINS },
      {
        type: "web_fetch_20250910",
        name: "web_fetch",
        max_uses: LIMITS.maxFetchesPerPlant,
        allowed_domains: ALLOWED_DOMAINS,
        max_content_tokens: LIMITS.maxContentTokensPerFetch,
      },
    ],
    messages: [{ role: "user", content: `Species (accepted botanical name): ${plant.canonical_name}` }],
  };
}

// parseProposal(content) -> proposal object | null (schema-shaped JSON text block)
export function parseProposal(content) {
  const text = (content || []).filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
