// Minimal Anthropic Messages API client for the completion step — plain
// fetch, the same raw-HTTP approach as pages/api/proxy.js and chat.js (no
// new dependency). The API key is only ever placed in the x-api-key
// header: it is never logged, never part of an error message, never
// written to any output file.

import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, LIMITS, PRICING } from "./completionConfig.js";

export class AnthropicApiError extends Error {
  constructor(status, type, message) {
    super(`Anthropic API error ${status}${type ? ` (${type})` : ""}: ${message}`);
    this.name = "AnthropicApiError";
    this.status = status;
    this.type = type;
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

// postMessages(body, { apiKey, fetchImpl, sleep }) -> parsed response JSON
export async function postMessages(body, { apiKey, fetchImpl = fetch, sleep = defaultSleep, maxRetries = LIMITS.maxRetries } = {}) {
  if (!apiKey) throw new Error("postMessages: ANTHROPIC_API_KEY is not configured");
  let attempt = 0;
  for (;;) {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok) return data;
    const type = data?.error?.type ?? null;
    const message = data?.error?.message ?? "request failed";
    if (RETRYABLE.has(response.status) && attempt < maxRetries) {
      attempt += 1;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new AnthropicApiError(response.status, type, message);
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// runWithPauseTurn(body, opts) -> { content, responses, usage, stopReason }
// Server tools (web search/fetch) may pause a long turn with
// stop_reason "pause_turn": the paused assistant content is sent back
// unchanged to continue. `content` is every assistant block across all
// continuations, in order — what grounding.js reads.
export async function runWithPauseTurn(body, opts = {}) {
  const responses = [];
  const content = [];
  let messages = body.messages;
  for (let i = 0; i <= LIMITS.maxPauseTurnContinuations; i += 1) {
    const response = await postMessages({ ...body, messages }, opts);
    responses.push(response);
    content.push(...(response?.content ?? []));
    if (response?.stop_reason !== "pause_turn") break;
    messages = [...body.messages, { role: "assistant", content }];
  }
  const last = responses[responses.length - 1];
  return { content, responses, usage: sumUsage(responses.map((r) => r?.usage)), stopReason: last?.stop_reason ?? null };
}

export function sumUsage(usages) {
  const total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
  for (const u of usages) {
    if (!u) continue;
    total.input_tokens += u.input_tokens || 0;
    total.output_tokens += u.output_tokens || 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    total.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    total.web_search_requests += u.server_tool_use?.web_search_requests || u.web_search_requests || 0;
    total.web_fetch_requests += u.server_tool_use?.web_fetch_requests || u.web_fetch_requests || 0;
  }
  return total;
}

// costUsd(usage) — list prices from completionConfig.js (web fetch: tokens only).
export function costUsd(usage) {
  const u = usage || {};
  return (
    ((u.input_tokens || 0) * PRICING.inputPerMTok) / 1e6 +
    ((u.output_tokens || 0) * PRICING.outputPerMTok) / 1e6 +
    ((u.cache_creation_input_tokens || 0) * PRICING.cacheWritePerMTok) / 1e6 +
    ((u.cache_read_input_tokens || 0) * PRICING.cacheReadPerMTok) / 1e6 +
    (u.web_search_requests || 0) * PRICING.webSearchPerRequest
  );
}
