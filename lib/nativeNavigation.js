// Client-side navigation for the native (Capacitor) static export.
//
// Capacitor's local web server answers every path whose last segment has
// no extension with index.html (Android WebViewLocalServer, html5mode on by
// default; iOS CapacitorRouter.route). In the static export that means a
// plain <a href="/profile"> full page load silently renders the HOME page
// at /profile — on the web, Next serves each page and the same link works.
// Next's own client-side router, on the other hand, loads a page's JS
// chunk from the build manifest and never requests its HTML, so it works
// for every route, including /plant-finder/[slug].
//
// So, on native only (never installed on the web):
//   1. one document-level click listener turns same-origin clicks on plain
//      <a href> links to a known page into router.push() — every existing
//      and future link (Sidebar, MobileNav, Button, Card, PlantFinderCard,
//      ...) is covered without touching any of them;
//   2. a cold start/reload that landed on a non-root route (index.html
//      served as the fallback, so Next rendered "/") is corrected once with
//      router.replace() to the real URL.
//
// Both only ever route to a path matching a page listed in Next's build
// manifest: anything else (an unknown path, "/reset-password.html", an
// API path) is left to the browser exactly as before, so this can never
// loop on a path Next cannot render client-side.

// Pages that are never navigation targets (Next internals, API routes).
function isPageRoute(route) {
  return typeof route === "string" && route !== "/_app" && route !== "/_error" && route !== "/_document" && !route.startsWith("/api/");
}

// "/plant-finder/[slug]" -> /^\/plant-finder\/[^/]+$/ ; "[...x]" and
// "[[...x]]" catch-alls are supported too.
function routeToRegExp(route) {
  const segments = route.split("/").filter(Boolean).map((segment) => {
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.+)?";
    if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
    if (/^\[.+\]$/.test(segment)) return "/[^/]+";
    return "/" + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp("^" + (segments.join("") || "/") + "$");
}

export function matchesKnownRoute(pathname, knownRoutes) {
  if (!Array.isArray(knownRoutes) || typeof pathname !== "string") return false;
  return knownRoutes.filter(isPageRoute).some((route) => routeToRegExp(route).test(pathname));
}

// Reads the page list from Next's build manifest (self.__BUILD_MANIFEST,
// loaded by the static export's own _buildManifest.js script). null when
// unavailable — callers then do nothing.
export function getKnownRoutes(win = typeof window !== "undefined" ? window : undefined) {
  const pages = win?.__BUILD_MANIFEST?.sortedPages;
  return Array.isArray(pages) ? pages.filter(isPageRoute) : null;
}

// Decision function for one click. Returns the local path to router.push()
// (pathname + search + hash), or null to leave the click to the browser.
//   event:    { defaultPrevented, button, metaKey, ctrlKey, shiftKey, altKey }
//   anchor:   { href (absolute, as the DOM resolves it), target, hasDownload }
//   location: { origin, pathname, search }
export function resolveInterceptedLinkPath({ event, anchor, location, knownRoutes }) {
  if (!event || !anchor || !location) return null;
  // Another handler already took over (e.g. [slug].js's back link calling
  // router.back()) — never override it.
  if (event.defaultPrevented) return null;
  // Middle/right click, or a modifier asking for a new tab/window/download.
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasDownload) return null;

  let url;
  try {
    url = new URL(anchor.href);
  } catch {
    return null;
  }
  // External links (privacy policy, Open-Meteo, ...) keep their native
  // system-browser behavior.
  if (url.origin !== location.origin) return null;
  // Same-page anchor: let the browser scroll.
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return null;
  if (!matchesKnownRoute(url.pathname, knownRoutes)) return null;

  return url.pathname + url.search + url.hash;
}

// Cold start/reload on a non-root route: the fallback index.html made
// Next render "/" while the URL is e.g. /profile. Returns the path to
// router.replace() to, or null when nothing needs correcting.
export function resolveColdStartPath({ routerPathname, location, knownRoutes }) {
  if (!location || routerPathname !== "/") return null;
  if (location.pathname === "/" || location.pathname === "/index.html") return null;
  if (!matchesKnownRoute(location.pathname, knownRoutes)) return null;
  return location.pathname + location.search + location.hash;
}

// Installs the click listener; returns its cleanup. Listening on document
// in the bubble phase runs AFTER React's own handlers (attached to the
// root container), so a handler that already called preventDefault() is
// seen as defaultPrevented above.
export function installNativeLinkRouting(router, doc = document, win = window) {
  const onClick = (event) => {
    const element = event.target instanceof win.Element ? event.target.closest("a[href]") : null;
    if (!element) return;
    const path = resolveInterceptedLinkPath({
      event,
      anchor: { href: element.href, target: element.getAttribute("target") || "", hasDownload: element.hasAttribute("download") },
      location: win.location,
      knownRoutes: getKnownRoutes(win),
    });
    if (!path) return;
    event.preventDefault();
    router.push(path);
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
