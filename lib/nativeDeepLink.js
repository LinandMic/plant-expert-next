// Native (Capacitor) incoming-URL / deep-link handling.
//
// Handles both the cold-launch URL (App.getLaunchUrl()) and the
// already-running case (the 'appUrlOpen' event) through @capacitor/app,
// and hands off only trusted, explicitly-supported Herbiose HTTPS URLs to
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
// whether it's a trusted, supported Herbiose link, and if so return the
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

function handleIncomingUrl(urlString, webOrigin) {
  const resolved = resolveNativeDeepLink(urlString, webOrigin);
  if (!resolved) return;
  window.location.href = resolved.localPath;
}

let initialized = false;

// Wires the cold-launch URL and the appUrlOpen event to
// resolveNativeDeepLink()/handleIncomingUrl(). No-ops on web and on
// repeated calls (idempotent — safe to call from _app.js on every mount).
export function initNativeDeepLinks(webOrigin) {
  if (!isNativePlatform() || initialized) return;
  initialized = true;

  App.addListener("appUrlOpen", (event) => handleIncomingUrl(event.url, webOrigin));

  App.getLaunchUrl().then((result) => {
    if (result?.url) handleIncomingUrl(result.url, webOrigin);
  });
}

export { SUPPORTED_NATIVE_ROUTES };
