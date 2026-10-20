import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getKnownRoutes,
  installNativeLinkRouting,
  matchesKnownRoute,
  resolveColdStartPath,
  resolveInterceptedLinkPath,
} from "./nativeNavigation.js";

// Same shape as the static export's own self.__BUILD_MANIFEST.sortedPages.
const SORTED_PAGES = [
  "/",
  "/_app",
  "/_error",
  "/api/account/delete",
  "/api/chat",
  "/api/proxy",
  "/api/weather",
  "/plant-finder",
  "/plant-finder/[slug]",
  "/profile",
  "/reset-password",
];
const ROUTES = SORTED_PAGES;
const ORIGIN = "https://localhost";
const LOCATION = { origin: ORIGIN, pathname: "/", search: "", hash: "" };
const CLICK = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

function decide({ href, event = {}, anchor = {}, location = LOCATION, knownRoutes = ROUTES }) {
  return resolveInterceptedLinkPath({
    event: { ...CLICK, ...event },
    anchor: { href: new URL(href, ORIGIN).href, target: "", hasDownload: false, ...anchor },
    location,
    knownRoutes,
  });
}

test("plain same-origin click on a known page is routed client-side (the bug: /profile, /plant-finder)", () => {
  assert.equal(decide({ href: "/profile" }), "/profile");
  assert.equal(decide({ href: "/plant-finder" }), "/plant-finder");
});

test("dynamic route keeps its path, query and hash (/plant-finder/[slug]?from=...)", () => {
  assert.equal(decide({ href: "/plant-finder/lavandula-angustifolia?from=q%3Dlav" }), "/plant-finder/lavandula-angustifolia?from=q%3Dlav");
  assert.equal(decide({ href: "/plant-finder/rosa#care" }), "/plant-finder/rosa#care");
});

test("home tab links (/?tab=...) are routed client-side with their query", () => {
  assert.equal(decide({ href: "/?tab=jardin", location: { ...LOCATION, pathname: "/profile" } }), "/?tab=jardin");
  assert.equal(decide({ href: "/?tab=identifier" }), "/?tab=identifier");
  assert.equal(decide({ href: "/", location: { ...LOCATION, pathname: "/profile" } }), "/");
});

test("modifier keys are never intercepted", () => {
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    assert.equal(decide({ href: "/profile", event: { [key]: true } }), null, key);
  }
});

test("non-left clicks are never intercepted", () => {
  assert.equal(decide({ href: "/profile", event: { button: 1 } }), null);
  assert.equal(decide({ href: "/profile", event: { button: 2 } }), null);
});

test("target=_blank (and any non-_self target) is never intercepted; _self is", () => {
  assert.equal(decide({ href: "/profile", anchor: { target: "_blank" } }), null);
  assert.equal(decide({ href: "/profile", anchor: { target: "other" } }), null);
  assert.equal(decide({ href: "/profile", anchor: { target: "_self" } }), "/profile");
});

test("external links (privacy policy, account deletion, Open-Meteo) are never intercepted", () => {
  assert.equal(decide({ href: "https://almeo.app/confidentialite/" }), null);
  assert.equal(decide({ href: "https://almeo.app/suppression-compte/" }), null);
  assert.equal(decide({ href: "https://open-meteo.com/" }), null);
  // Same path, different origin is still external.
  assert.equal(decide({ href: "https://app.almeo.app/profile" }), null);
});

test("download links are never intercepted", () => {
  assert.equal(decide({ href: "/profile", anchor: { hasDownload: true } }), null);
});

test("hash-only links on the same page are left to the browser", () => {
  assert.equal(decide({ href: "/profile#legal", location: { ...LOCATION, pathname: "/profile" } }), null);
  // ...but the same hash on ANOTHER page is a real navigation.
  assert.equal(decide({ href: "/profile#legal" }), "/profile#legal");
});

test("a click another handler already prevented is never overridden ([slug].js back link)", () => {
  assert.equal(decide({ href: "/plant-finder", event: { defaultPrevented: true } }), null);
});

test("unknown paths, .html files and API routes are left to the browser (no client-side loop)", () => {
  assert.equal(decide({ href: "/does-not-exist" }), null);
  assert.equal(decide({ href: "/reset-password.html" }), null);
  assert.equal(decide({ href: "/api/proxy" }), null);
  assert.equal(decide({ href: "/plant-finder/a/b" }), null);
  assert.equal(decide({ href: "/profile", knownRoutes: null }), null, "no manifest -> no interception");
});

test("missing inputs or an unparseable href never throw", () => {
  assert.equal(resolveInterceptedLinkPath({}), null);
  assert.equal(resolveInterceptedLinkPath({ event: CLICK, anchor: { href: "http://[bad" }, location: LOCATION, knownRoutes: ROUTES }), null);
});

test("matchesKnownRoute: static, dynamic and catch-all routes; never Next internals", () => {
  assert.equal(matchesKnownRoute("/", ROUTES), true);
  assert.equal(matchesKnownRoute("/plant-finder/x", ROUTES), true);
  assert.equal(matchesKnownRoute("/plant-finder/", ROUTES), false);
  assert.equal(matchesKnownRoute("/_app", ROUTES), false);
  assert.equal(matchesKnownRoute("/docs/a/b", ["/docs/[...slug]"]), true);
  assert.equal(matchesKnownRoute("/docs", ["/docs/[[...slug]]"]), true);
  assert.equal(matchesKnownRoute("/profile", undefined), false);
});

test("getKnownRoutes reads the build manifest and drops API/internal routes", () => {
  assert.deepEqual(getKnownRoutes({ __BUILD_MANIFEST: { sortedPages: SORTED_PAGES } }), [
    "/",
    "/plant-finder",
    "/plant-finder/[slug]",
    "/profile",
    "/reset-password",
  ]);
  assert.equal(getKnownRoutes({}), null);
  assert.equal(getKnownRoutes(undefined), null);
});

test("cold start on a non-root route (index.html fallback rendered '/') is corrected to the real URL", () => {
  assert.equal(
    resolveColdStartPath({ routerPathname: "/", location: { pathname: "/profile", search: "", hash: "" }, knownRoutes: ROUTES }),
    "/profile"
  );
  assert.equal(
    resolveColdStartPath({ routerPathname: "/", location: { pathname: "/plant-finder/rosa", search: "?from=q%3Dr", hash: "" }, knownRoutes: ROUTES }),
    "/plant-finder/rosa?from=q%3Dr"
  );
});

test("cold start: nothing to correct on '/', on a real page, or on an unknown path", () => {
  const at = (pathname, routerPathname = "/") => resolveColdStartPath({ routerPathname, location: { pathname, search: "", hash: "" }, knownRoutes: ROUTES });
  assert.equal(at("/"), null);
  assert.equal(at("/index.html"), null);
  assert.equal(at("/reset-password.html", "/reset-password"), null, "deep-link .html page already rendered itself");
  assert.equal(at("/profile", "/profile"), null);
  assert.equal(at("/unknown"), null);
  assert.equal(resolveColdStartPath({ routerPathname: "/", location: { pathname: "/profile", search: "", hash: "" }, knownRoutes: null }), null);
});

test("installNativeLinkRouting: prevents the default and pushes on an intercepted click; cleanup removes the listener", () => {
  class FakeElement {
    constructor(attrs) { this.attrs = attrs; this.href = new URL(attrs.href, ORIGIN).href; }
    closest() { return this; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
  }
  let listener = null;
  const doc = {
    addEventListener: (type, fn) => { assert.equal(type, "click"); listener = fn; },
    removeEventListener: (_type, fn) => { if (fn === listener) listener = null; },
  };
  const win = { Element: FakeElement, location: LOCATION, __BUILD_MANIFEST: { sortedPages: SORTED_PAGES } };
  const pushed = [];
  const cleanup = installNativeLinkRouting({ push: (p) => pushed.push(p) }, doc, win);

  const click = (attrs) => {
    const event = { ...CLICK, target: new FakeElement(attrs), preventDefault() { this.defaultPrevented = true; } };
    listener(event);
    return event.defaultPrevented;
  };
  assert.equal(click({ href: "/profile" }), true);
  assert.equal(click({ href: "https://almeo.app/confidentialite/", target: "_blank" }), false);
  assert.deepEqual(pushed, ["/profile"]);

  cleanup();
  assert.equal(listener, null);
});
