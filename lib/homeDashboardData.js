// Pure normalization/derivation helpers for the Accueil dashboard's
// connected-state data. Every real data source (garden, reminders,
// weather, profile) can legitimately be absent, still loading, or shaped
// differently than expected (undefined, null, a stale/partial object) —
// none of that may ever prevent the dashboard shell from rendering. Each
// function here degrades a missing/malformed input to a safe, neutral
// default instead of throwing, so the caller can always build a
// displayable model.

export function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeWeather(value) {
  return value && typeof value === "object" ? value : null;
}

// findTodayWeather(weather, todayStr) -> the day entry matching todayStr,
// or null when weather is absent, malformed, or has no matching day.
export function findTodayWeather(weather, todayStr) {
  const safeWeather = normalizeWeather(weather);
  const days = safeWeather ? normalizeList(safeWeather.days) : [];
  return days.find((d) => d && d.date === todayStr) || null;
}

export function weatherCityLabel(weather) {
  const safeWeather = normalizeWeather(weather);
  return (safeWeather && safeWeather.location && safeWeather.location.city) || null;
}

function isVisibleReminder(reminder) {
  return Boolean(reminder) && reminder.isActive === true && (reminder.status === "pending" || reminder.status === "snoozed");
}

function hasComparableDueDate(reminder) {
  return typeof reminder.nextDueDate === "string" && reminder.nextDueDate.length > 0;
}

// countDueReminders/countOverdueReminders tolerate reminders missing
// nextDueDate/isActive/status entirely, or a non-array `reminders` value —
// a malformed row is simply excluded, never thrown on. "Due" includes
// today; "overdue" is strictly before today (same split the dashboard has
// always used: "à traiter aujourd'hui" vs "rappels en retard").
export function countDueReminders(reminders, todayStr) {
  return normalizeList(reminders).filter(
    (r) => isVisibleReminder(r) && hasComparableDueDate(r) && r.nextDueDate <= todayStr
  ).length;
}

export function countOverdueReminders(reminders, todayStr) {
  return normalizeList(reminders).filter(
    (r) => isVisibleReminder(r) && hasComparableDueDate(r) && r.nextDueDate < todayStr
  ).length;
}

// plantDisplayName(plant) -> the plant's common name, or null. Never
// assumes `plant` or `plant.data` is present/shaped as expected.
export function plantDisplayName(plant) {
  return (plant && plant.data && plant.data.identite && plant.data.identite.nom_commun) || null;
}

// resolveGreetingName(rawFirstName) -> a non-empty, trimmed first name, or
// null. A profile that is null/absent, or has a blank/whitespace-only
// first name, must never crash the hero — and must never be shown as an
// empty/invented greeting either.
export function resolveGreetingName(rawFirstName) {
  return typeof rawFirstName === "string" && rawFirstName.trim() ? rawFirstName.trim() : null;
}

// buildConnectedHomeModel({ plants, reminders, weather, today }) -> a
// fully-safe, directly-displayable model for the connected Accueil
// dashboard. Every field defaults to an empty/neutral value instead of
// ever letting one missing/malformed data source prevent the rest of the
// dashboard (hero, "Dans votre jardin", "Actions rapides") from rendering.
export function buildConnectedHomeModel({ plants, reminders, weather, today }) {
  return {
    plants: normalizeList(plants),
    dueCount: countDueReminders(reminders, today),
    overdueCount: countOverdueReminders(reminders, today),
    todayWeather: findTodayWeather(weather, today),
    weatherCity: weatherCityLabel(weather),
  };
}
