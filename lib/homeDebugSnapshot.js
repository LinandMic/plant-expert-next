// Pure builder for the ?homeDebug=1 diagnostic panel (temporary
// investigation aid, spec: "Add production home render diagnostics").
// This is the single choke point every value shown by the debug panel goes
// through — it NEVER passes through an email, user id, token, or any real
// garden/reminder/weather content, only booleans, counts, and type labels.
// Keeping this as a pure function (rather than inlining the object literal
// in the page) is what makes "no sensitive data leaks" a testable
// guarantee instead of a promise.

import { normalizeList } from "./homeDashboardData.js";

export function describeDataType(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// buildHomeDebugSnapshot({ mounted, authLoading, user, profile, jardin,
// reminders, weather, activeNav, pathname }) -> a plain, JSON-serializable
// object of booleans/counts/type-strings only.
export function buildHomeDebugSnapshot({
  mounted,
  authLoading,
  user,
  profile,
  jardin,
  reminders,
  weather,
  activeNav,
  pathname,
}) {
  return {
    pageReached: true,
    mounted: Boolean(mounted),
    authLoading: Boolean(authLoading),
    authenticated: Boolean(user),
    userPresent: Boolean(user),
    firstNamePresent: Boolean(profile && profile.first_name),
    jardinType: describeDataType(jardin),
    jardinCount: normalizeList(jardin).length,
    remindersType: describeDataType(reminders),
    remindersCount: normalizeList(reminders).length,
    weatherType: describeDataType(weather),
    dashboardWillRender: activeNav === "accueil",
    dashboardBranch: Boolean(user) ? "connected" : "disconnected",
    pathname: typeof pathname === "string" ? pathname : "",
  };
}
