// Local cache of RAW API responses (including fetched page text), so a
// lot can be re-decided (parsers, grounding, decision rules) without paying
// again. Lives under scripts/plant-ingestion/output/ (gitignored — never
// committed), one file per plant and call kind, and can be deleted at any
// time. It is private working data: nothing from it is ever copied into the
// editorial / common-names outputs.
//
// Each entry stores a hash of the request body: --execute only reuses an
// entry whose request is byte-identical (same prompt, tools, limits);
// --replay reuses whatever is cached and reports a hash mismatch.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function requestHash(body) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function entryPath(cacheDir, slug, kind) {
  return path.join(cacheDir, slug, `${kind}.json`);
}

export function readCacheEntry(cacheDir, slug, kind) {
  const file = entryPath(cacheDir, slug, kind);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeCacheEntry(cacheDir, slug, kind, body, run) {
  const file = entryPath(cacheDir, slug, kind);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ request_hash: requestHash(body), cached_at: new Date().toISOString(), content: run.content, usage: run.usage, stopReason: run.stopReason }, null, 2));
}

// cachedCallApi({ cacheDir, liveCallApi, mode }) -> callApi(body, { slug, kind })
// mode "execute": identical cached request -> reused (no cost); otherwise
//   live call, then cached.
// mode "replay": cache only; never calls liveCallApi.
export function cachedCallApi({ cacheDir, liveCallApi, mode }) {
  return async (body, { slug, kind }) => {
    const cached = readCacheEntry(cacheDir, slug, kind);
    const hash = requestHash(body);
    if (mode === "replay") {
      if (!cached) {
        const error = new Error(`no cached ${kind} response for ${slug} (replay mode never calls the API)`);
        error.code = "CACHE_MISS";
        throw error;
      }
      return { content: cached.content, usage: cached.usage, stopReason: cached.stopReason, fromCache: true, requestChanged: cached.request_hash !== hash };
    }
    if (cached && cached.request_hash === hash) {
      return { content: cached.content, usage: cached.usage, stopReason: cached.stopReason, fromCache: true, requestChanged: false };
    }
    const run = await liveCallApi(body);
    writeCacheEntry(cacheDir, slug, kind, body, run);
    return { ...run, fromCache: false, requestChanged: false };
  };
}
