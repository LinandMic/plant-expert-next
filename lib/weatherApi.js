// Explicit ".js" extensions: loaded directly by plain `node --test` via
// lib/weatherApi.test.js — same reasoning as lib/accountApi.js/chatApi.js.
//
// Client-side wrapper around the server-only /api/weather route. Never
// calls Open-Meteo directly from the browser — the route holds the
// geocoding/forecast logic and this file only knows how to talk to it.
//
// Mirrors lib/accountApi.js's/lib/chatApi.js's injectable-factory shape
// and native/web URL resolution pattern: the native app is a static
// export with no local "/api/*" routes to resolve against, so native
// must resolve against the deployed HTTPS web origin
// (NEXT_PUBLIC_WEB_ORIGIN), exactly like the account-deletion, chat, and
// analysis APIs already do — weather was the one caller that hadn't
// picked up this pattern yet.
import { isNativePlatform, getWebOrigin } from "./platform.js";

const ENDPOINT_PATH = "/api/weather";
const GENERIC_ERROR = "Impossible de récupérer la météo pour le moment.";

function hasUsableCity(profile) {
  return !!(profile && typeof profile.city === "string" && profile.city.trim());
}

export function createWeatherClient({
  isNative = isNativePlatform,
  webOrigin = getWebOrigin,
  fetchImpl,
} = {}) {
  // Same reasoning as lib/accountApi.js's/lib/chatApi.js's resolveUrl().
  function resolveUrl() {
    if (!isNative()) return ENDPOINT_PATH;
    const origin = webOrigin();
    if (!origin) {
      throw new Error(
        "NEXT_PUBLIC_WEB_ORIGIN is not configured — the native app cannot reach /api/weather without it."
      );
    }
    return `${origin}${ENDPOINT_PATH}`;
  }

  // fetchWeatherForProfile(profile) — profile is the { city, region, country }
  // shape returned by lib/profileApi.js's fetchProfile (region/country may be
  // null/empty). Returns { data, error, code } — response contract is
  // unchanged from before this fix:
  //   - data: the normalized { location, days } payload, or null
  //   - error: a user-facing generic message, or null on success
  //   - code: "NO_LOCATION" | "LOCATION_NOT_FOUND" | "WEATHER_DATA_INVALID" |
  //     "WEATHER_UNAVAILABLE" | null on success
  async function fetchWeatherForProfile(profile) {
    if (!hasUsableCity(profile)) {
      return { data: null, error: null, code: "NO_LOCATION" };
    }

    let url;
    try {
      url = resolveUrl();
    } catch (e) {
      console.error("fetchWeatherForProfile:", e.message);
      return { data: null, error: GENERIC_ERROR, code: "WEATHER_UNAVAILABLE" };
    }

    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) {
      return { data: null, error: GENERIC_ERROR, code: "WEATHER_UNAVAILABLE" };
    }

    let response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: profile.city,
          region: profile.region || null,
          country: profile.country || null,
        }),
      });
    } catch (e) {
      console.error("fetchWeatherForProfile network error", e);
      return { data: null, error: GENERIC_ERROR, code: "WEATHER_UNAVAILABLE" };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (e) {
      console.error("fetchWeatherForProfile invalid JSON response", e);
      return { data: null, error: GENERIC_ERROR, code: "WEATHER_UNAVAILABLE" };
    }

    if (!payload || payload.ok !== true) {
      const code = (payload && payload.code) || "WEATHER_UNAVAILABLE";
      return { data: null, error: GENERIC_ERROR, code };
    }

    return { data: { location: payload.location, days: payload.days }, error: null, code: null };
  }

  return { fetchWeatherForProfile, resolveUrl };
}

export const { fetchWeatherForProfile } = createWeatherClient();
