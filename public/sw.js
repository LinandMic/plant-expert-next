// Herbiose service worker — PWA foundation round 1.
//
// Deliberately minimal: this exists to make the app installable, not to
// provide offline behavior. It caches ONLY the fixed, truly-static PWA
// assets listed below (the manifest + its icon files) — never a page,
// never a _next/static bundle, never an API route, never a Supabase
// response. Every other request is left completely alone and goes
// straight to the network, so nothing here can ever serve stale app
// content or stale data. A later round can add real offline/asset
// caching deliberately; this round intentionally does not.

const CACHE_NAME = "herbiose-static-v1";
const STATIC_ASSETS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {
        // A failed pre-cache must never block installation — the SW
        // still installs, those few assets just fall through to network
        // on first request instead (see the fetch handler below).
      })
  );
  // Skip the "wait until old tabs close" step so a deployed update takes
  // over promptly instead of silently lagging behind — paired with
  // clients.claim() below (spec: "update propre du service worker").
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname)) {
    // Everything else — every page, every /_next/* bundle, every /api/*
    // route, every Supabase request — is intentionally never intercepted.
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
