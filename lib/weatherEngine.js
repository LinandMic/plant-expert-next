// Pure watering-weather recommendation engine.
// No network calls, no Supabase, no React — a deterministic function of its
// inputs so it can be tested and reasoned about in isolation. It NEVER
// mutates a reminder: it only ever returns a recommendation for the UI to
// display, leaving every actual mutation to an explicit user action.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- V1 heuristics -----------------------------------------------------
// These are PRODUCT heuristics for Weather Watering V1, not scientific
// constants. They are intentionally conservative (favor KEEP or
// INSUFFICIENT_DATA over a wrong CONSIDER_SNOOZE/CHECK_SOONER) and are
// expected to be tuned as real usage data comes in.
export const RECENT_RAIN_DAYS = 3;
export const FORECAST_RAIN_DAYS = 3;
export const HEAVY_RECENT_RAIN_MM = 10;
export const HEAVY_FORECAST_RAIN_MM = 10;
export const FORECAST_RAIN_PROBABILITY_MIN = 60;
export const HOT_DAY_C = 30;
export const SNOOZE_SUGGESTION_OFFSET_DAYS = 2;

// Exposures treated as "sunny enough" to factor into CHECK_SOONER.
// unknown/partial values are deliberately excluded — only a confirmed
// sunny exposure should push toward a heat-driven check.
const SUNNY_EXPOSURES = ["full_sun", "partial_sun"];

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function sumFinite(values) {
  return values.filter(isFiniteNumber).reduce((acc, v) => acc + v, 0);
}

function maxFinite(values) {
  const finite = values.filter(isFiniteNumber);
  return finite.length ? Math.max(...finite) : null;
}

// Local calendar-day arithmetic only — never toISOString()/UTC — so the
// suggested date matches the same local-day convention used by
// lib/reminderApi.js's computeNextDueDate.
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function insufficientData(reasons) {
  return { status: "INSUFFICIENT_DATA", confidence: null, message: null, suggestedDate: null, reasons };
}

/**
 * evaluateWateringWeather({ weather, reminder, plantContext, today })
 *
 * - weather: the normalized { days: [{date, precipitationMm,
 *   precipitationProbabilityMax, temperatureMaxC, temperatureMinC}] }
 *   object returned by lib/weatherApi.js, or null/undefined.
 * - reminder: the watering reminder this recommendation is for (only
 *   `nextDueDate` is used in V1), or null/undefined.
 * - plantContext: the plant's context (only `exposure` is used in V1), or
 *   null/undefined.
 * - today: the caller's local "today" as a "YYYY-MM-DD" string. Passed in
 *   rather than computed here so this function stays pure/deterministic.
 *
 * Returns { status, confidence, message, suggestedDate, reasons }.
 * status is one of KEEP | CONSIDER_SNOOZE | CHECK_SOONER | INSUFFICIENT_DATA.
 * confidence is one of "high" | "medium" | "low" | null.
 */
export function evaluateWateringWeather({ weather, reminder, plantContext, today }) {
  const days = weather && Array.isArray(weather.days) ? weather.days : null;
  if (!days || days.length === 0 || typeof today !== "string" || !DATE_RE.test(today)) {
    return insufficientData(["Données météo absentes ou date de référence invalide."]);
  }

  const todayIndex = days.findIndex((d) => d && d.date === today);
  if (todayIndex === -1) {
    return insufficientData(["Le jour courant n'est pas présent dans les données météo reçues."]);
  }

  // "Recent" = the days strictly before today; "forecast" = the days
  // strictly after today. Today itself is excluded from both rain windows
  // (it's a transition point, not "past" or "future" rain), but its own
  // max temperature still counts toward the near-term heat check below.
  const recentDays = days.slice(Math.max(0, todayIndex - RECENT_RAIN_DAYS), todayIndex);
  const forecastDays = days.slice(todayIndex + 1, todayIndex + 1 + FORECAST_RAIN_DAYS);

  const hasRecentRainData = recentDays.some((d) => isFiniteNumber(d.precipitationMm));
  const hasForecastRainData = forecastDays.some((d) => isFiniteNumber(d.precipitationMm));

  if (!hasRecentRainData && !hasForecastRainData) {
    return insufficientData([
      "Ni la pluie récente ni la pluie prévue ne sont exploitables dans les données reçues.",
    ]);
  }

  const recentRainMm = sumFinite(recentDays.map((d) => d.precipitationMm));
  const forecastRainMm = sumFinite(forecastDays.map((d) => d.precipitationMm));
  const maxForecastProbability = maxFinite(forecastDays.map((d) => d.precipitationProbabilityMax));

  // --- CONSIDER_SNOOZE --------------------------------------------------
  const heavyRecentRain = hasRecentRainData && recentRainMm >= HEAVY_RECENT_RAIN_MM;
  const heavyForecastRain =
    hasForecastRainData &&
    forecastRainMm >= HEAVY_FORECAST_RAIN_MM &&
    maxForecastProbability !== null &&
    maxForecastProbability >= FORECAST_RAIN_PROBABILITY_MIN;

  if (heavyRecentRain || heavyForecastRain) {
    const reasons = [];
    if (heavyRecentRain) {
      reasons.push(`Pluie cumulée des ${RECENT_RAIN_DAYS} derniers jours : ${recentRainMm.toFixed(1)} mm.`);
    }
    if (heavyForecastRain) {
      reasons.push(
        `Pluie prévue sur ${FORECAST_RAIN_DAYS} jours : ${forecastRainMm.toFixed(1)} mm (probabilité max ${maxForecastProbability}%).`
      );
    }

    // Two independent signals agreeing (already rained a lot AND more is
    // coming) is a stronger case than either alone.
    const confidence = heavyRecentRain && heavyForecastRain ? "high" : "medium";

    let suggestedDate = null;
    if (reminder && typeof reminder.nextDueDate === "string" && DATE_RE.test(reminder.nextDueDate)) {
      suggestedDate = addDaysToDateString(reminder.nextDueDate, SNOOZE_SUGGESTION_OFFSET_DAYS);
    }

    return {
      status: "CONSIDER_SNOOZE",
      confidence,
      message:
        "Pluie récente ou prévue importante — l'arrosage prévu est peut-être moins nécessaire. Tu peux le reporter si tu le souhaites.",
      suggestedDate,
      reasons,
    };
  }

  // --- CHECK_SOONER ------------------------------------------------------
  // Only considered once CONSIDER_SNOOZE has been ruled out. Deliberately
  // conservative: a false "check sooner" is more annoying than a false
  // "keep", so every condition must hold at once.
  const exposure = plantContext && plantContext.exposure;
  const isSunny = SUNNY_EXPOSURES.includes(exposure);
  const todayMaxTemp = isFiniteNumber(days[todayIndex].temperatureMaxC) ? days[todayIndex].temperatureMaxC : null;
  const maxUpcomingTemp = maxFinite([todayMaxTemp, ...forecastDays.map((d) => d.temperatureMaxC)]);
  const hotDay = maxUpcomingTemp !== null && maxUpcomingTemp >= HOT_DAY_C;
  const lowRecentRain = !hasRecentRainData || recentRainMm < HEAVY_RECENT_RAIN_MM;
  const lowForecastRain = !hasForecastRainData || forecastRainMm < HEAVY_FORECAST_RAIN_MM;

  if (hotDay && lowRecentRain && lowForecastRain && isSunny) {
    return {
      status: "CHECK_SOONER",
      confidence: "medium",
      message:
        "Forte chaleur annoncée et peu de pluie — une vérification avant l'échéance prévue peut être utile pour cette plante exposée au soleil.",
      suggestedDate: null,
      reasons: [
        `Température max attendue : ${maxUpcomingTemp}°C.`,
        `Exposition : ${exposure}.`,
      ],
    };
  }

  // --- KEEP ---------------------------------------------------------------
  return {
    status: "KEEP",
    confidence: "medium",
    message: null,
    suggestedDate: null,
    reasons: [],
  };
}
