// Tests pages/api/weather.js's origin/CORS behavior via its injectable
// createWeatherHandler({ fetchImpl }) factory — mirrors the DI style
// established by lib/apiProxyHandler.test.js / lib/apiChatHandler.test.js.
// The fake fetchImpl stands in for the real Open-Meteo calls so these
// tests never touch the network; they only exercise the same
// lib/apiOrigin.js-based origin/CORS policy every other API route uses.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createWeatherHandler, pickBestGeocodingResult } from "../pages/api/weather.js";

const HOST = "plant-expert-next-rxq9.vercel.app";
const VALID_BODY = { city: "Lyon" };

function makeReq({ method = "POST", origin, referer, body = VALID_BODY } = {}) {
  const headers = { host: HOST };
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;
  return { method, headers, body };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

// A minimal fake that answers both the geocoding and forecast calls with
// just enough shape for the route to reach a 200 — the point of these
// tests is the origin/CORS gate, not weather product logic (already
// covered, unchanged, by this route's own existing behavior).
function makeFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("geocoding-api")) {
      return {
        ok: true,
        async json() {
          return { results: [{ name: "Lyon", admin1: "Auvergne-Rhône-Alpes", country: "France", country_code: "FR", latitude: 45.76, longitude: 4.83 }] };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          timezone: "Europe/Paris",
          daily: {
            time: ["2026-09-24"],
            precipitation_sum: [0],
            precipitation_probability_max: [5],
            temperature_2m_max: [20],
            temperature_2m_min: [12],
          },
        };
      },
    };
  };
  return { fetchImpl, calls };
}

test("GET is rejected", async () => {
  const { fetchImpl } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ method: "GET", origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("trusted same-origin web request succeeds with no CORS headers set", async () => {
  const { fetchImpl, calls } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("allowed native Capacitor origin gets scoped CORS, same allowlist as proxy/chat", async () => {
  const { fetchImpl } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ origin: "capacitor://localhost" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
  assert.equal(res.headers["Vary"], "Origin");
});

test("the other trusted native origin (https://localhost, Android) also passes", async () => {
  const { fetchImpl } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ origin: "https://localhost" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://localhost");
});

test("OPTIONS for native origin permits only POST and Content-Type (no Authorization needed — this route is unauthenticated)", async () => {
  const { fetchImpl } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ method: "OPTIONS", origin: "capacitor://localhost" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "POST");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type");
});

test("unknown external origin is rejected before any outbound call", async () => {
  const { fetchImpl, calls } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ origin: "https://evil.example.com" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
  assert.equal(calls.length, 0);
});

test("missing origin but same-origin Referer is still allowed (fallback, matches proxy/chat)", async () => {
  const { fetchImpl } = makeFetch();
  const handler = createWeatherHandler({ fetchImpl });
  const req = makeReq({ referer: `https://${HOST}/profile` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
});

test("existing product logic (pickBestGeocodingResult) is untouched by this fix", () => {
  const results = [
    { name: "Lyon", admin1: "Auvergne-Rhône-Alpes", country: "France", country_code: "FR", latitude: 45.76, longitude: 4.83 },
    { name: "Lyon", admin1: "Ohio", country: "United States", country_code: "US", latitude: 40.68, longitude: -82.63 },
  ];
  const best = pickBestGeocodingResult(results, "France", null);
  assert.equal(best.country_code, "FR");
});
