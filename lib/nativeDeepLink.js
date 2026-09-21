// Native (Capacitor) incoming-URL / deep-link handling.
//
// Handles both the cold-launch URL (App.getLaunchUrl()) and the
// already-running case (the 'appUrlOpen' event) through @capacitor/app,
// and hands off only trusted, explicitly-supported Almeo HTTPS URLs to
// the app's own local pages. Only imported/called from native platforms
// (see isNativePlatform() in lib/platform.js) — @capacitor/app's web
// fallback is pure JS and safe to import at module scope regardless, but
// initNativeDeepLinks() below no-ops entirely on web, so it is simply
// never invoked there (same pattern as lib/nativeCamera.js).
//
// Supabase recovery handoff (this repo's currently installed behavior —
// verified against node_modules/@supabase/auth-js, not assumed):
// lib/supabaseClient.js constructs the client with no `flowType` override,
// so GoTrueClient defaults to `flowType: 'implicit'` with
// `detectSessionInUrl: true`. That means a password-recovery link delivers
// its session as a URL *hash* fragment (`#access_token=...&type=recovery`
// -- not a PKCE `?code=` query param), and the SDK only ever parses that
// hash once, inside its own one-time `_initialize()` call made when the
// module-level `supabase` client is first constructed on page load — there
// is no hashchange listener. A client-side (SPA) route change to
// /reset-password#... after the app has already booted would therefore
// NOT be picked up. So the handoff below always does a *hard* navigation
// (window.location.href = ...), which fully reloads the native app's
// local static export at that path: a fresh module load means a fresh
// `supabase` client, whose _initialize() parses the hash exactly as it
// does for a normal web page load, firing the same PASSWORD_RECOVERY
// auth event pages/reset-password.js already listens for.
import { App } from "@capacitor/app";
import { isNativePlatform } from "./platform.js";

// Only these local paths may be reached via an incoming native URL. Deep
// links to anything else (a different path, or a non-matching host/scheme)
// are rejected outright rather than silently falling through to some
// default route.
const SUPPORTED_NATIVE_ROUTES = new Set(["/reset-password"]);

// Pure allowlist + parsing: given the raw URL string Capacitor's App
// plugin hands us and the app's own configured web origin
// (NEXT_PUBLIC_WEB_ORIGIN via lib/platform.js's getWebOrigin()), decide
// whether it's a trusted, supported Almeo link, and if so return the
// local path (path + query + hash, so auth params survive) to hard-navigate
// the WebView to. Returns null for anything untrusted or unsupported —
// never allow arbitrary external navigation inside the WebView.
export function resolveNativeDeepLink(urlString, webOrigin) {
  if (!urlString || !webOrigin) return null;

  let incoming;
  let configured;
  try {
    incoming = new URL(urlString);
    configured = new URL(webOrigin);
  } catch {
    return null;
  }

  if (incoming.protocol !== "https:") return null;
  if (configured.protocol !== "https:") return null;
  if (incoming.origin !== configured.origin) return null;
  if (!SUPPORTED_NATIVE_ROUTES.has(incoming.pathname)) return null;

  return { localPath: `${incoming.pathname}${incoming.search}${incoming.hash}` };
}

// Duplicate-delivery guard.
//
// The hard navigation above reloads the whole WebView, which re-runs
// _app.js -> initNativeDeepLinks() with fresh module state. On Android,
// App.getLaunchUrl() reads Capacitor's Bridge.intentUri, which is captured
// once from the launching Activity intent and never cleared (verified in
// node_modules/@capacitor/android Bridge.java + @capacitor/app
// AppPlugin.java) — so it returns the SAME launch URL after every reload.
// Without a guard, each reload re-delivers that URL, which hard-navigates
// again: an endless reload loop. On a cold start the same URL is also
// delivered twice in one document (a retained 'appUrlOpen' from
// BridgeActivity.load(), plus getLaunchUrl()).
//
// So each trusted URL is handled at most once per native WebView session.
// "Handled" is remembered in sessionStorage, which survives the hard reload
// (same WebView, same origin) but is discarded when the WebView is
// destroyed — a later cold start begins with an empty guard, so it is
// never a persistent record.
//
// What is stored: only a short non-reversible fingerprint of the exact URL,
// never the URL itself, so the recovery access/refresh tokens in the hash
// are not written anywhere. The fingerprint is an exact-match marker for
// duplicate suppression only, not a security control; the origin/path
// allowlist in resolveNativeDeepLink() is what decides trust. A set is kept
// (not just "the last URL") so a stale launch URL A cannot be re-handled
// after a newer URL B has been: A stays suppressed for the whole session,
// while a genuinely new URL C has no marker and is still handled.
const HANDLED_STORAGE_KEY = "almeo.nativeDeepLink.handled";
const MAX_HANDLED_MARKERS = 20;

// cyrb53: small, fast, synchronous 53-bit string hash. Not cryptographic —
// it only needs to be a stable exact-match key that doesn't reveal the URL.
export function fingerprintUrl(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function readMarkers(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(HANDLED_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns true the first time `urlString` is seen this session (and records
// it), false for every repeat of the exact same URL. `storage` is a
// sessionStorage-like object (getItem/setItem); `memory` is an in-process
// fallback that still de-duplicates within one document if storage is
// unavailable or throws.
export function claimNativeUrl(urlString, storage, memory = new Set()) {
  const marker = fingerprintUrl(urlString);
  const stored = readMarkers(storage);
  if (memory.has(marker) || stored.includes(marker)) return false;

  memory.add(marker);
  try {
    storage?.setItem(
      HANDLED_STORAGE_KEY,
      JSON.stringify([...stored, marker].slice(-MAX_HANDLED_MARKERS)),
    );
  } catch {
    // Storage unavailable: `memory` still guards this document.
  }
  return true;
}

// Validates, de-duplicates, then navigates. Untrusted/unsupported URLs are
// rejected BEFORE anything is recorded. Returns what happened so callers
// and tests can observe it; never logs the URL (it may carry tokens).
export function handleIncomingUrl(urlString, webOrigin, { storage, memory, navigate } = {}) {
  const resolved = resolveNativeDeepLink(urlString, webOrigin);
  if (!resolved) return "rejected";
  if (!claimNativeUrl(urlString, storage, memory)) return "duplicate";
  navigate(resolved.localPath);
  return "navigated";
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

let initialized = false;
const memoryHandled = new Set();

// Wires the cold-launch URL and the appUrlOpen event to
// handleIncomingUrl(). No-ops on web and on repeated calls (idempotent —
// safe to call from _app.js on every mount).
export function initNativeDeepLinks(webOrigin) {
  if (!isNativePlatform() || initialized) return;
  initialized = true;

  const handle = (url) =>
    handleIncomingUrl(url, webOrigin, {
      storage: getSessionStorage(),
      memory: memoryHandled,
      navigate: (localPath) => {
        window.location.href = localPath;
      },
    });

  App.addListener("appUrlOpen", (event) => handle(event.url));

  App.getLaunchUrl().then((result) => {
    if (result?.url) handle(result.url);
  });
}

export { SUPPORTED_NATIVE_ROUTES };
