// Client-side wrapper around the server-only /api/weather route. Never
// calls Open-Meteo directly from the browser — the route holds the
// geocoding/forecast logic and this file only knows how to talk to it.

const ENDPOINT = "/api/weather";
const GENERIC_ERROR = "Impossible de récupérer la météo pour le moment.";

function hasUsableCity(profile) {
  return !!(profile && typeof profile.city === "string" && profile.city.trim());
}

// fetchWeatherForProfile(profile) — profile is the { city, region, country }
// shape returned by lib/profileApi.js's fetchProfile (region/country may be
// null/empty). Returns { data, error, code }:
//   - data: the normalized { location, days } payload, or null
//   - error: a user-facing generic message, or null on success
//   - code: "NO_LOCATION" | "LOCATION_NOT_FOUND" | "WEATHER_DATA_INVALID" |
//     "WEATHER_UNAVAILABLE" | null on success
export async function fetchWeatherForProfile(profile) {
  if (!hasUsableCity(profile)) {
    return { data: null, error: null, code: "NO_LOCATION" };
  }

  let response;
  try {
    response = await fetch(ENDPOINT, {
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
