// Completion step configuration (scripts/plant-ingestion/src/completion/).
//
// Everything that decides WHO is a source, HOW MUCH may be spent and WHICH
// model runs lives here, as plain data — never inferred from a model
// answer. Publisher names, the institutional flag and license labels come
// from SOURCE_DOMAINS below, keyed by the URL's hostname, so a model can
// never invent or upgrade a source's identity.

export const COMPLETION_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

// Validated site list. `traits`: may support horticultural traits.
// `names_fr`: may support the preferred French common name.
export const SOURCE_DOMAINS = Object.freeze({
  "rhs.org.uk": {
    publisher: "Royal Horticultural Society (RHS)",
    institutional: true,
    traits: true,
    names_fr: false,
    license: "© Royal Horticultural Society — copyrighted content, referenced for factual values only, no content reproduced",
  },
  "missouribotanicalgarden.org": {
    publisher: "Missouri Botanical Garden — Plant Finder",
    institutional: true,
    traits: true,
    names_fr: false,
    license: "© Missouri Botanical Garden — referenced for factual values only, no content reproduced",
  },
  "plants.ces.ncsu.edu": {
    publisher: "NC State Extension Gardener Plant Toolbox (NC State University)",
    institutional: true,
    traits: true,
    names_fr: false,
    license: "NC State Extension public-education resource — referenced for factual values only, no content reproduced",
  },
  "gardenersworld.com": {
    publisher: "BBC Gardeners' World",
    institutional: false,
    traits: true,
    names_fr: false,
    license: "© Immediate Media / BBC Gardeners' World — referenced for factual values only, no content reproduced",
  },
  "tela-botanica.org": {
    publisher: "Tela Botanica",
    institutional: false,
    traits: true,
    names_fr: true,
    license: "Tela Botanica (eFlore) — CC BY-SA content, referenced for factual values only, no content reproduced",
  },
  "inpn.mnhn.fr": {
    publisher: "INPN — Muséum national d'Histoire naturelle",
    institutional: true,
    traits: false,
    names_fr: true,
    license: "INPN / MNHN — referenced for factual values only, no content reproduced",
  },
  "powo.science.kew.org": {
    publisher: "Plants of the World Online (Royal Botanic Gardens, Kew)",
    institutional: true,
    traits: false,
    names_fr: false,
    license: "© Board of Trustees of the Royal Botanic Gardens, Kew — referenced for factual values only, no content reproduced",
  },
});

export const ALLOWED_DOMAINS = Object.keys(SOURCE_DOMAINS);

// sourceInfoForUrl(url) -> { domain, ...SOURCE_DOMAINS[domain] } | null
// Matches the hostname itself or any subdomain of an allowed domain.
export function sourceInfoForUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const domain of ALLOWED_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return { domain, ...SOURCE_DOMAINS[domain] };
  }
  return null;
}

// Curation license of OUR synthesis (never copied from a source license) —
// the same value the existing editorial files use.
export const CURATION_LICENSE = "proprietary_internal_curation_v1";

export const LIMITS = Object.freeze({
  proposalMaxTokens: 2000,
  evidenceMaxTokens: 8000,
  maxSearchesPerPlant: 6,
  maxFetchesPerPlant: 6,
  maxContentTokensPerFetch: 12000,
  maxPauseTurnContinuations: 3,
  maxRetries: 2,
});

// Sonnet 5.5 list prices (USD) — https://platform.claude.com/docs/en/about-claude/pricing
export const PRICING = Object.freeze({
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheWritePerMTok: 2.5,
  cacheReadPerMTok: 0.1,
  webSearchPerRequest: 0.01,
});

// Conservative worst case for ONE plant (proposal + evidence incl. up to
// 6 searches, 6 fetches capped at 12k tokens each, server-loop re-reads
// and pause_turn continuations). Used only to refuse starting a plant
// that could push spending past the hard cap.
export const WORST_CASE_PER_PLANT_USD = 0.75;
export const DEFAULT_BUDGET_CAP_USD = 8;

// Expected range per plant (for --estimate only).
export const EXPECTED_PER_PLANT_USD = Object.freeze({ low: 0.15, high: 0.35 });

// Agreement tolerances (decide.js).
export const TOLERANCES = Object.freeze({
  lengthRelative: 0.25, // 25 % between two sources / AI vs retained
  lengthAbsoluteCm: 30, // or within 30 cm for small plants
  monthsOverlapRatio: 0.5, // |intersection| / |union| >= 0.5
});
