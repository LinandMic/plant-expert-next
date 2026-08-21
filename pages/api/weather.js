// Server-side weather proxy: geocodes a profile's city/region/country via
// Open-Meteo's Geocoding API, then fetches a short daily forecast for the
// resulting coordinates. The browser never talks to Open-Meteo directly and
// never sends latitude/longitude — only free-text city/region/country, which
// this route resolves itself so a client can't spoof coordinates.

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 8000;
const MAX_FIELD_LENGTH = 200;

// aujourd'hui + 3 jours à venir, plus les 3 jours passés.
const PAST_DAYS = 3;
const FORECAST_DAYS = 4;

const DAILY_VARS = [
  "precipitation_sum",
  "precipitation_probability_max",
  "temperature_2m_max",
  "temperature_2m_min",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10kb",
    },
  },
};

function isRequestFromAllowedOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;

  const originHeader = req.headers.origin;
  if (originHeader) {
    try {
      return new URL(originHeader).host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return false;
}

function cleanField(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

function normalize(value) {
  return (value || "").trim().toLowerCase();
}

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    try {
      const data = await response.json();
      return { ok: true, data };
    } catch {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// A supplied country is a hard filter: if it's given but no candidate
// matches it, we refuse to silently fall back to an unrelated same-named
// city in a different country. A supplied region is only a soft
// preference — Open-Meteo's admin1 naming doesn't always line up exactly
// with a profile's free-text region.
function pickBestGeocodingResult(results, country, region) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const wantCountry = normalize(country);
  const wantRegion = normalize(region);

  let candidates = results;
  if (wantCountry) {
    const countryMatches = results.filter(
      (r) => normalize(r.country) === wantCountry || normalize(r.country_code) === wantCountry
    );
    if (countryMatches.length === 0) return null;
    candidates = countryMatches;
  }

  if (wantRegion) {
    const regionMatches = candidates.filter((r) => {
      const admin1 = normalize(r.admin1);
      return admin1 && (admin1.includes(wantRegion) || wantRegion.includes(admin1));
    });
    if (regionMatches.length > 0) candidates = regionMatches;
  }

  return candidates[0] || null;
}

async function geocode(city, region, country) {
  const params = new URLSearchParams({ name: city, count: "10", language: "fr", format: "json" });
  const result = await fetchJsonWithTimeout(`${GEOCODING_URL}?${params.toString()}`);
  if (!result.ok) return { ok: false, code: "WEATHER_UNAVAILABLE" };

  const results = result.data && Array.isArray(result.data.results) ? result.data.results : [];
  const best = pickBestGeocodingResult(results, country, region);
  if (!best || !Number.isFinite(best.latitude) || !Number.isFinite(best.longitude)) {
    return { ok: false, code: "LOCATION_NOT_FOUND" };
  }

  return {
    ok: true,
    location: {
      name: best.name || city,
      region: best.admin1 || null,
      country: best.country || null,
      latitude: best.latitude,
      longitude: best.longitude,
    },
  };
}

async function fetchWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: DAILY_VARS.join(","),
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    timezone: "auto",
  });
  const result = await fetchJsonWithTimeout(`${FORECAST_URL}?${params.toString()}`);
  if (!result.ok) return { ok: false, code: "WEATHER_UNAVAILABLE" };

  const daily = result.data && result.data.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    return { ok: false, code: "WEATHER_DATA_INVALID" };
  }

  const n = daily.time.length;
  for (const key of DAILY_VARS) {
    if (!Array.isArray(daily[key]) || daily[key].length !== n) {
      return { ok: false, code: "WEATHER_DATA_INVALID" };
    }
  }
  for (const date of daily.time) {
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return { ok: false, code: "WEATHER_DATA_INVALID" };
    }
  }

  const days = daily.time.map((date, i) => ({
    date,
    precipitationMm: numOrNull(daily.precipitation_sum[i]),
    precipitationProbabilityMax: numOrNull(daily.precipitation_probability_max[i]),
    temperatureMaxC: numOrNull(daily.temperature_2m_max[i]),
    temperatureMinC: numOrNull(daily.temperature_2m_min[i]),
  }));

  const timezone = typeof result.data.timezone === "string" ? result.data.timezone : null;
  return { ok: true, timezone, days };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isRequestFromAllowedOrigin(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const city = cleanField(body.city);
  const region = cleanField(body.region);
  const country = cleanField(body.country);

  if (!city) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const geo = await geocode(city, region, country);
    if (!geo.ok) {
      return res.status(200).json({ ok: false, code: geo.code });
    }

    const weather = await fetchWeather(geo.location.latitude, geo.location.longitude);
    if (!weather.ok) {
      return res.status(200).json({ ok: false, code: weather.code });
    }

    return res.status(200).json({
      ok: true,
      location: {
        name: geo.location.name,
        region: geo.location.region,
        country: geo.location.country,
        latitude: geo.location.latitude,
        longitude: geo.location.longitude,
        timezone: weather.timezone,
      },
      days: weather.days,
    });
  } catch (error) {
    console.error("Weather route error:", error);
    return res.status(200).json({ ok: false, code: "WEATHER_UNAVAILABLE" });
  }
}
