// Local, gitignored, disk-backed cache for provider network fetches — lets
// an ingestion Layer A rerun reuse already-retrieved WCVP/Perenual/Trefle
// responses instead of re-hitting rate/plan-limited APIs (real regression:
// a batch-12 rebuild burned Perenual's free-plan 100 req/day quota and
// silently overwrote a previously-rich bundle with 40 provider_error
// results). This module ONLY affects provider retrieval — normalization,
// crosswalks, observation-building and selection logic are always
// recomputed from whatever raw data (fresh or cached) comes back, so a code
// fix like selections.js's plant_type trust-policy change takes effect on a
// cached rerun with zero new network calls.
//
// createCachedFetch({ cacheDir, refresh, fetchImpl }) returns a function
// with EXACTLY fetchJson's contract — { ok, status, data, url } on success,
// { ok: false, status, error, body?, url } on failure — so it is a drop-in
// replacement anywhere a provider accepts a `fetchImpl` override. Two
// extra, purely additive fields are present on a successful result:
// `retrieved_at` (ISO timestamp of the ORIGINAL successful fetch — stable
// across cache hits, never refreshed just because the cache was read) and
// `cached` (whether this call avoided the network).
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { fetchJson, redactUrl } from "./httpClient.js";

// The cache key AND the persisted `url` field are always derived from the
// REDACTED url — the real url (containing a live API key as a query param
// for Perenual/Trefle) is only ever used in-memory to perform the actual
// fetch, never written to disk. See httpClient.js's redactUrl.
export function cacheKeyForUrl(url) {
  const redacted = redactUrl(url);
  return crypto.createHash("sha256").update(redacted).digest("hex").slice(0, 32);
}

function cacheFilePath(cacheDir, providerName, key) {
  return path.join(cacheDir, providerName || "unknown", `${key}.json`);
}

// Never throws: a missing file, a directory that doesn't exist yet, or
// invalid JSON all resolve to `null` (cache miss) — the caller falls back
// to a real network fetch cleanly (spec: "cache JSON invalide => fallback
// réseau propre").
function readCacheEntry(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("data" in parsed) || !("retrieved_at" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Atomic write: a temp file in the same directory, then rename — a reader
// (this process or a concurrent one) never observes a partially-written
// cache file (spec: "écriture atomique fichier temporaire + rename").
function writeCacheEntryAtomic(filePath, entry) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, JSON.stringify(entry, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

export function createCachedFetch({ cacheDir, refresh = false, fetchImpl = fetchJson } = {}) {
  return async function cachedFetchJson(url, options = {}) {
    const providerName = options.providerName || "unknown";
    const key = cacheKeyForUrl(url);
    const filePath = cacheFilePath(cacheDir, providerName, key);

    if (!refresh) {
      const cached = readCacheEntry(filePath);
      if (cached) {
        return { ok: true, status: cached.status, data: cached.data, url: cached.url, retrieved_at: cached.retrieved_at, cached: true };
      }
    }

    const result = await fetchImpl(url, options);

    if (result.ok) {
      // A successful response ALWAYS overwrites any prior cache entry for
      // this exact key — this is the only case where overwriting is
      // correct (spec: never let an error poison a good cache entry, but a
      // fresh success is real new provenance).
      const retrieved_at = new Date().toISOString();
      writeCacheEntryAtomic(filePath, { url: redactUrl(url), status: result.status, data: result.data, retrieved_at });
      return { ...result, url: redactUrl(url), retrieved_at, cached: false };
    }

    // Network failed. Never poison/overwrite an existing successful cache
    // entry with this failure (spec: 429/plan_restricted/provider_error/
    // timeout must never replace a good cached response). If this was an
    // explicit --refresh attempt and a prior successful entry exists,
    // gracefully fall back to it — the entire point of this cache is
    // resilience against exactly this (a quota exhausted mid-rebuild)
    // rather than losing previously-good data.
    if (refresh) {
      const stale = readCacheEntry(filePath);
      if (stale) {
        return { ok: true, status: stale.status, data: stale.data, url: stale.url, retrieved_at: stale.retrieved_at, cached: true, stale_fallback: true };
      }
    }

    return { ...result, cached: false };
  };
}
