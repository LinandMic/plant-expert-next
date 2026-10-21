// Recorded-response fixtures for the completion step. Structural test data
// only — a fictional species ("Testus exemplaris") and synthetic page
// texts; no real horticultural claim is made or implied (same convention
// as the rest of this suite). No test ever reaches the network.

export const PLANT = {
  catalog_ref: "testus_exemplaris_species",
  taxon_ref: "testus_exemplaris",
  slug: "testus-exemplaris",
  canonical_name: "Testus exemplaris",
};

export const PAGES = {
  rhs: {
    url: "https://www.rhs.org.uk/plants/99999/testus-exemplaris/details",
    title: "Testus exemplaris | RHS",
    text: "Testus exemplaris. Type: Evergreen shrub. Ultimate height 2–4 metres. Ultimate spread 1.5–2.5 metres. Sunlight: Full sun, Partial shade. Moisture: Moist but well-drained. Flowering season(s) Spring.",
  },
  mbg: {
    url: "https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderDetails.aspx?taxonid=99999",
    title: "Testus exemplaris - Plant Finder",
    text: "Testus exemplaris. Type: Broadleaf evergreen shrub. Height: 6.00 to 12.00 feet. Spread: 5.00 to 8.00 feet. Bloom Time: March to May. Sun: Full sun to part shade. Water: Medium. Foliage: Evergreen.",
  },
  inpn: {
    url: "https://inpn.mnhn.fr/espece/cd_nom/999999",
    title: "Testus exemplaris L., 1753",
    text: "Testus exemplaris L., 1753. Nom vernaculaire : Testier commun, Testier d'exemple.",
  },
  tela: {
    url: "https://www.tela-botanica.org/bdtfx-nn-99999-synthese",
    title: "Testus exemplaris - eFlore",
    text: "Testus exemplaris L. Noms communs : Testier commun. Floraison : mars à mai. Feuillage persistant.",
  },
};

export const PROPOSAL = {
  plant_type: "shrub",
  sun: ["full_sun", "partial_sun"],
  height_min_cm: 200,
  height_max_cm: 350,
  spread_max_cm: 250,
  evergreen: true,
  water_need: "moderate",
  flowering_months: [3, 4, 5],
  common_name_fr: "Testier commun",
};

export const EVIDENCE_JSON = {
  sources: [
    {
      url: PAGES.rhs.url,
      traits: {
        plant_type: "Type: Evergreen shrub",
        height: "Ultimate height 2–4 metres",
        spread: "Ultimate spread 1.5–2.5 metres",
        sun: "Sunlight: Full sun, Partial shade",
        evergreen: "Type: Evergreen shrub",
        water_need: "Moisture: Moist but well-drained",
        flowering_months: "Flowering season(s) Spring",
      },
      common_name_fr: null,
    },
    {
      url: PAGES.mbg.url,
      traits: {
        plant_type: "Type: Broadleaf evergreen shrub",
        height: "Height: 6.00 to 12.00 feet",
        spread: "Spread: 5.00 to 8.00 feet",
        sun: "Sun: Full sun to part shade",
        evergreen: "Foliage: Evergreen",
        water_need: "Water: Medium",
        flowering_months: "Bloom Time: March to May",
      },
      common_name_fr: null,
    },
    { url: PAGES.inpn.url, traits: { common_name_fr: "Nom vernaculaire : Testier commun, Testier d'exemple." }, common_name_fr: "Testier commun" },
    { url: PAGES.tela.url, traits: { common_name_fr: "Noms communs : Testier commun." }, common_name_fr: "Testier commun" },
  ],
};

let toolId = 0;
function fetchBlocks(page) {
  toolId += 1;
  const id = `srvtoolu_fetch_${toolId}`;
  return [
    { type: "server_tool_use", id, name: "web_fetch", input: { url: page.url } },
    {
      type: "web_fetch_tool_result",
      tool_use_id: id,
      content: {
        type: "web_fetch_result",
        url: page.url,
        content: { type: "document", source: { type: "text", media_type: "text/plain", data: page.text }, title: page.title },
        retrieved_at: "2026-10-21T10:00:00Z",
      },
    },
  ];
}

function fetchErrorBlocks(url, errorCode) {
  toolId += 1;
  const id = `srvtoolu_fetch_${toolId}`;
  return [
    { type: "server_tool_use", id, name: "web_fetch", input: { url } },
    { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_tool_result_error", error_code: errorCode } },
  ];
}

function searchBlocks(urls) {
  toolId += 1;
  const id = `srvtoolu_search_${toolId}`;
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query: "Testus exemplaris" } },
    { type: "web_search_tool_result", tool_use_id: id, content: urls.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "ENC", page_age: null })) },
  ];
}

// evidenceContent({ pages, blocked, evidence }) -> assistant content blocks
export function evidenceContent({ pages = Object.values(PAGES), blocked = [], evidence = EVIDENCE_JSON } = {}) {
  return [
    { type: "text", text: "Je cherche les pages de référence." },
    ...searchBlocks([...pages.map((p) => p.url), ...blocked.map((b) => b.url)]),
    ...pages.flatMap(fetchBlocks),
    ...blocked.flatMap((b) => fetchErrorBlocks(b.url, b.error_code)),
    { type: "text", text: "```json\n" + JSON.stringify(evidence) + "\n```" },
  ];
}

export function proposalContent(proposal = PROPOSAL) {
  return [{ type: "text", text: JSON.stringify(proposal) }];
}

export const USAGE_PROPOSAL = { input_tokens: 1500, output_tokens: 600 };
export const USAGE_EVIDENCE = { input_tokens: 60000, output_tokens: 2500, server_tool_use: { web_search_requests: 3, web_fetch_requests: 4 } };

// fakeCallApi(map) — answers by request kind (tools present = evidence).
export function fakeCallApi({ proposal = PROPOSAL, evidenceOptions = {}, calls = [] } = {}) {
  return async (body) => {
    calls.push(body);
    if (body.tools) return { content: evidenceContent(evidenceOptions), usage: USAGE_EVIDENCE, stopReason: "end_turn" };
    return { content: proposalContent(proposal), usage: USAGE_PROPOSAL, stopReason: "end_turn" };
  };
}

export const DRAFT_EMPTY_ROW = {
  slug: PLANT.slug,
  taxon_id: "taxon-uuid-1",
  publication_status: "draft",
  plant_type: null,
  sun: null,
  height_min_cm: null,
  height_max_cm: null,
  spread_max_cm: null,
  evergreen: null,
  water_need: null,
  flowering_months: null,
  preferred_common_name_fr: null,
};
