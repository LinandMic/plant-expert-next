// Pure helpers for pages/index.js's URL <-> tab sync (Phase 4.1). The only
// two real, non-default tab keys "/" switches on (`activeNav === "..."` in
// pages/index.js) are "identifier" and "jardin" — every other value,
// including a missing one, is "accueil". Standalone pages (Plant Finder)
// link here with `?tab=identifier` / `?tab=jardin` — see
// components/ui/externalNavItems.js.
export const VALID_TABS = ["identifier", "jardin"];

// tabFromQuery(routerQuery) -> "accueil" | "identifier" | "jardin"
// Never trusts an unrecognized/tampered query value into activeNav — it
// silently falls back to "accueil", the same default "/" always had.
export function tabFromQuery(query) {
  const tab = query && typeof query.tab === "string" ? query.tab : null;
  return VALID_TABS.includes(tab) ? tab : "accueil";
}

// tabToQuery(tab) -> {} | { tab }
// The inverse of tabFromQuery: what the URL's query object should look like
// for a given tab. "accueil" is the default and never appears in the URL.
export function tabToQuery(tab) {
  return tab === "accueil" ? {} : { tab };
}

// Plant Finder's "no result" screen sends a search text to the Identifier
// tab as `/?tab=identifier&name=<text>`, so it is pre-filled in the
// plant-name field. Nothing is analyzed automatically — the user still
// presses "Analyser" (it consumes an AI credit).
export const MAX_PREFILL_NAME_LENGTH = 100;

// nameFromQuery(routerQuery) -> string ("" when absent/invalid)
// Only a single string value is trusted (never an array); trimmed and
// length-capped like any user-typed text.
export function nameFromQuery(query) {
  const name = query && typeof query.name === "string" ? query.name.trim() : "";
  return name.slice(0, MAX_PREFILL_NAME_LENGTH);
}

// identifierHrefForName(name) -> "/?tab=identifier&name=..." (or the plain
// Identifier tab when the name is empty). A same-origin "/" link: a full
// load on the web, client-side via lib/nativeNavigation.js on native.
export function identifierHrefForName(name) {
  const trimmed = typeof name === "string" ? name.trim().slice(0, MAX_PREFILL_NAME_LENGTH) : "";
  return trimmed ? `/?tab=identifier&name=${encodeURIComponent(trimmed)}` : "/?tab=identifier";
}
