// Grounding: turns the evidence call's raw API content into a list of
// GROUNDED observations, i.e. values this code itself extracted from text
// the API actually fetched during that call. Pure, no I/O.
//
// A source passage only counts when ALL of the following hold:
//   1. its URL was successfully fetched by web_fetch in this very call
//      (search results are encrypted, so a page must be fetched to count);
//   2. the URL's site is in SOURCE_DOMAINS (identity/publisher/license
//      come from that table, never from the model);
//   3. the passage appears verbatim (after whitespace/accent/case folding)
//      in the fetched page text;
//   4. textParsers.js parses a value from that passage.
// Passages themselves are never returned or stored — only the parsed
// value, the URL and whether it was grounded.

import { sourceInfoForUrl } from "./completionConfig.js";
import { normalizeText, parseTraitValue, quoteContainsName } from "./textParsers.js";

export const TRAIT_KEYS = ["plant_type", "height", "spread", "sun", "evergreen", "water_need", "flowering_months"];

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// collectFetchedDocuments(content) -> { docs: Map<canonicalUrl, {url,title,text,retrieved_at}>, fetchLog, searchLog }
export function collectFetchedDocuments(content) {
  const docs = new Map();
  const fetchLog = [];
  const searchLog = [];
  const requested = new Map(); // tool_use_id -> url requested
  for (const block of content || []) {
    if (block?.type === "server_tool_use" && block.name === "web_fetch") requested.set(block.id, block.input?.url ?? null);
  }
  for (const block of content || []) {
    if (block?.type === "web_fetch_tool_result") {
      const c = block.content || {};
      if (c.type === "web_fetch_result") {
        const doc = c.content || {};
        const isText = doc.source?.type === "text" && typeof doc.source.data === "string";
        const key = canonicalUrl(c.url);
        fetchLog.push({ url: c.url, domain: sourceInfoForUrl(c.url)?.domain ?? hostOf(c.url), ok: isText, error_code: isText ? null : "non_text_content" });
        if (isText && key) docs.set(key, { url: c.url, title: doc.title ?? null, text: normalizeText(doc.source.data), retrieved_at: c.retrieved_at ?? null });
      } else {
        const url = requested.get(block.tool_use_id) ?? null;
        fetchLog.push({ url, domain: url ? sourceInfoForUrl(url)?.domain ?? hostOf(url) : null, ok: false, error_code: c.error_code ?? "unknown_error" });
      }
    } else if (block?.type === "web_search_tool_result") {
      if (Array.isArray(block.content)) {
        for (const r of block.content) searchLog.push({ url: r.url, domain: sourceInfoForUrl(r.url)?.domain ?? hostOf(r.url), ok: true, error_code: null });
      } else {
        searchLog.push({ url: null, domain: null, ok: false, error_code: block.content?.error_code ?? "unknown_error" });
      }
    }
  }
  return { docs, fetchLog, searchLog };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// extractFinalJson(content) -> object | null — the ```json block (or the
// last balanced {...}) of the final text after the last tool result.
export function extractFinalJson(content) {
  const blocks = content || [];
  let lastToolIndex = -1;
  blocks.forEach((b, i) => {
    if (b?.type === "web_fetch_tool_result" || b?.type === "web_search_tool_result") lastToolIndex = i;
  });
  const text = blocks
    .slice(lastToolIndex + 1)
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : lastBalancedObject(text);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function lastBalancedObject(text) {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  let depth = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (text[i] === "}") depth += 1;
    else if (text[i] === "{") {
      depth -= 1;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return null;
}

// groundEvidence(evidence, docs) -> { observations, rejected }
// observations: [{ trait, value, url, domain, publisher, institutional, license, title, retrieved_at }]
// trait "common_name_fr" carries value = the name as written.
export function groundEvidence(evidence, docs) {
  const observations = [];
  const rejected = [];
  for (const source of evidence?.sources || []) {
    const url = source?.url;
    const info = url ? sourceInfoForUrl(url) : null;
    const doc = url ? docs.get(canonicalUrl(url)) : null;
    const traits = source?.traits && typeof source.traits === "object" ? source.traits : {};
    const reject = (trait, reason) => rejected.push({ url: url ?? null, domain: info?.domain ?? (url ? hostOf(url) : null), trait, reason });

    if (!info) {
      reject("*", "site_not_allowed");
      continue;
    }
    if (!doc) {
      reject("*", "url_not_fetched_in_this_call");
      continue;
    }
    const base = { url: doc.url, domain: info.domain, publisher: info.publisher, institutional: info.institutional, license: info.license, title: doc.title, retrieved_at: doc.retrieved_at };

    for (const trait of TRAIT_KEYS) {
      const quote = traits[trait];
      if (typeof quote !== "string" || !quote.trim()) continue;
      if (!info.traits) {
        reject(trait, "site_not_used_for_traits");
        continue;
      }
      if (!doc.text.includes(normalizeText(quote))) {
        reject(trait, "passage_not_found_in_page");
        continue;
      }
      const value = parseTraitValue(trait, quote);
      if (value === null || value === undefined) {
        reject(trait, "passage_not_parseable");
        continue;
      }
      observations.push({ trait, value, ...base });
    }

    const nameQuote = traits.common_name_fr;
    const name = typeof source.common_name_fr === "string" ? source.common_name_fr.trim() : "";
    if (typeof nameQuote === "string" && nameQuote.trim() && name) {
      if (!info.names_fr) reject("common_name_fr", "site_not_used_for_names");
      else if (!doc.text.includes(normalizeText(nameQuote))) reject("common_name_fr", "passage_not_found_in_page");
      else if (!quoteContainsName(nameQuote, name)) reject("common_name_fr", "name_not_in_passage");
      else observations.push({ trait: "common_name_fr", value: name, ...base });
    }
  }
  return { observations, rejected };
}
