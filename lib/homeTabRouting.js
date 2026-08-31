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
