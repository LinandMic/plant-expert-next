// Tests lib/weatherApi.js's pure client-side request logic via its
// injectable createWeatherClient({ isNative, webOrigin, fetchImpl })
// factory — no DOM, no real network call. Matches the DI style used by
// lib/accountApi.test.js / lib/chatApi.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createWeatherClient } from "./weatherApi.js";

const PROFILE = { city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "France" };

function makeFakeFetch({ ok = true, status = 200, body = { ok: true, location: { name: "Lyon" }, days: [] } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, async json() { return body; } };
  };
  return { fetchImpl, calls };
}

test("web (non-native): posts to the relative /api/weather path", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await fetchWeatherForProfile(PROFILE);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/weather");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.city, "Lyon");
});

test("native: posts to the absolute deployed origin, never a relative path", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => true,
    webOrigin: () => "https://almeo.app",
    fetchImpl,
  });

  await fetchWeatherForProfile(PROFILE);
  assert.equal(calls[0].url, "https://almeo.app/api/weather");
});

test("native with no configured web origin: fails loudly (generic error), never guesses a URL", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => true,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await fetchWeatherForProfile(PROFILE);
  assert.equal(result.data, null);
  assert.equal(result.code, "WEATHER_UNAVAILABLE");
  assert.equal(calls.length, 0);
});

test("no usable city: returns NO_LOCATION without attempting a fetch, on both web and native", async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => true,
    webOrigin: () => "https://almeo.app",
    fetchImpl,
  });

  const result = await fetchWeatherForProfile({ city: "" });
  assert.deepEqual(result, { data: null, error: null, code: "NO_LOCATION" });
  assert.equal(calls.length, 0);
});

test("network failure surfaces as WEATHER_UNAVAILABLE", async () => {
  const fetchImpl = async () => { throw new Error("offline"); };
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await fetchWeatherForProfile(PROFILE);
  assert.equal(result.data, null);
  assert.equal(result.code, "WEATHER_UNAVAILABLE");
});

test("server-reported failure code is passed through unchanged (response contract preserved)", async () => {
  const { fetchImpl } = makeFakeFetch({ body: { ok: false, code: "LOCATION_NOT_FOUND" } });
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await fetchWeatherForProfile(PROFILE);
  assert.equal(result.data, null);
  assert.equal(result.code, "LOCATION_NOT_FOUND");
});

test("success: returns exactly { location, days } from the server payload, contract unchanged", async () => {
  const days = [{ date: "2026-09-24", precipitationMm: 0, precipitationProbabilityMax: 10, temperatureMaxC: 20, temperatureMinC: 12 }];
  const { fetchImpl } = makeFakeFetch({ body: { ok: true, location: { name: "Lyon", region: "ARA", country: "France", latitude: 45.76, longitude: 4.83, timezone: "Europe/Paris" }, days } });
  const { fetchWeatherForProfile } = createWeatherClient({
    isNative: () => false,
    webOrigin: () => null,
    fetchImpl,
  });

  const result = await fetchWeatherForProfile(PROFILE);
  assert.equal(result.error, null);
  assert.equal(result.code, null);
  assert.equal(result.data.location.name, "Lyon");
  assert.deepEqual(result.data.days, days);
});
