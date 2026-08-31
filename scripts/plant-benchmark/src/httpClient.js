// Small fetch wrapper shared by all three providers: timeout, bounded
// retries, a conservative per-provider rate limit, and structured
// success/failure results. Never throws for an HTTP or network failure —
// see README "Fiabilité" — so one bad request can never abort the run.

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3; // 1 initial + 2 retries, never more
const DEFAULT_RETRY_BASE_MS = 600;
const DEFAULT_MAX_RETRY_WAIT_MS = 10000; // hard cap, even honoring Retry-After

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Perenual observed live: a Personal-plan key hitting a plan-gated endpoint
// (e.g. species/details) returns HTTP 429 with a body like "Please Upgrade
// Plan – https://www.perenual.com/subscription-api-pricing. Sorry" — this
// is a SUBSCRIPTION restriction, not a transient rate limit, and must never
// be treated as either. Detection is deterministic content-matching only:
// a generic 429 (plain "too many requests", no upgrade-plan wording) must
// NOT be classified as plan_restricted — it stays a normal rate limit.
const PLAN_RESTRICTED_BODY_MARKERS = [/please\s*upgrade\s*plan/i, /subscription-api-pricing/i];

export function isPlanRestrictedBody(body) {
  if (!body || typeof body !== "string") return false;
  return PLAN_RESTRICTED_BODY_MARKERS.some((re) => re.test(body));
}

// Strips anything that looks like a credential from a URL before it is ever
// logged or written to an output/raw file.
function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const key of ["key", "token", "api_key", "apikey"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return "[unparseable url]";
  }
}

// One min-interval-between-requests throttle per provider name. Simple and
// sequential — sufficient for a ~20-plant benchmark, never a way to exceed
// a provider's documented rate limit.
const lastRequestAtByProvider = new Map();

async function throttle(providerName, minIntervalMs) {
  const last = lastRequestAtByProvider.get(providerName) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < minIntervalMs) await wait(minIntervalMs - elapsed);
  lastRequestAtByProvider.set(providerName, Date.now());
}

/**
 * fetchJson(url, options) -> always resolves to either
 *   { ok: true, status, data, url }
 * or
 *   { ok: false, status, error, body?, url }
 * never throws for HTTP/network/timeout failures.
 */
export async function fetchJson(url, options = {}) {
  const {
    providerName = "unknown",
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    minIntervalMs = 1100,
  } = options;

  const safeUrl = redactUrl(url);
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle(providerName, minIntervalMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      lastStatus = response.status;

      if (response.status === 429) {
        let body = null;
        try { body = await response.text(); } catch { /* ignore */ }

        if (isPlanRestrictedBody(body)) {
          // A subscription restriction, not a transient rate limit — never
          // retried (retrying cannot change a plan restriction), and never
          // conflated with a generic rate-limit/provider_error below.
          console.error(`[${providerName}] GET ${safeUrl} -> 429 plan_restricted (${elapsedMs}ms)`);
          return { ok: false, status: 429, error: "plan_restricted", body, url: safeUrl };
        }

        console.error(`[${providerName}] GET ${safeUrl} -> 429 (${elapsedMs}ms) attempt ${attempt}/${maxAttempts}`);
        if (attempt < maxAttempts) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
          const backoff = Math.min(
            Number.isFinite(retryAfterMs) ? retryAfterMs : DEFAULT_RETRY_BASE_MS * 2 ** (attempt - 1),
            DEFAULT_MAX_RETRY_WAIT_MS
          );
          await wait(backoff);
          continue;
        }
        return { ok: false, status: 429, error: "rate_limited", body, url: safeUrl };
      }

      if (response.status >= 500) {
        console.error(`[${providerName}] GET ${safeUrl} -> ${response.status} (${elapsedMs}ms) attempt ${attempt}/${maxAttempts}`);
        if (attempt < maxAttempts) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
          const backoff = Math.min(
            Number.isFinite(retryAfterMs) ? retryAfterMs : DEFAULT_RETRY_BASE_MS * 2 ** (attempt - 1),
            DEFAULT_MAX_RETRY_WAIT_MS
          );
          await wait(backoff);
          continue;
        }
        let body = null;
        try { body = await response.text(); } catch { /* ignore */ }
        return { ok: false, status: response.status, error: "http_error", body, url: safeUrl };
      }

      if (!response.ok) {
        console.error(`[${providerName}] GET ${safeUrl} -> ${response.status} (${elapsedMs}ms)`);
        let body = null;
        try { body = await response.text(); } catch { /* ignore */ }
        return { ok: false, status: response.status, error: "http_error", body, url: safeUrl };
      }

      const data = await response.json();
      console.error(`[${providerName}] GET ${safeUrl} -> ${response.status} (${elapsedMs}ms)`);
      return { ok: true, status: response.status, data, url: safeUrl };
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err && err.name === "AbortError";
      lastError = timedOut ? "timeout" : (err && err.message) || "network_error";
      console.error(`[${providerName}] GET ${safeUrl} -> ${lastError} attempt ${attempt}/${maxAttempts}`);
      if (attempt < maxAttempts) {
        await wait(Math.min(DEFAULT_RETRY_BASE_MS * 2 ** (attempt - 1), DEFAULT_MAX_RETRY_WAIT_MS));
        continue;
      }
    }
  }

  return { ok: false, status: lastStatus, error: lastError || "unknown_error", url: safeUrl };
}
