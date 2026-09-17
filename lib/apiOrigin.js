// Shared origin/CORS policy for Herbiose server API routes that must accept
// both the normal same-origin web app AND the native Capacitor app shells
// (which call the deployed origin cross-origin, from their own local
// WebView origin) while still rejecting random external websites.
//
// Capacitor's local origins come from its own defaults — this project's
// capacitor.config.ts does not override server.hostname/iosScheme/
// androidScheme, so the values below are what @capacitor/cli's own
// declarations.d.ts documents as the defaults:
//   iOS:     <iosScheme>://<hostname>     -> capacitor://localhost
//   Android: <androidScheme>://<hostname> -> https://localhost
// These are origins the OS WebView itself sets as the Origin header on
// outgoing requests — a script on an arbitrary external website cannot
// spoof them (the browser/WebView controls the Origin header, not page
// script) — so safelisting them exactly does not reopen the endpoint to
// the public web the way `Access-Control-Allow-Origin: *` would.
export const ALLOWED_NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);

// Classifies an incoming request's Origin header against the request's own
// Host header (the API route's own deployed host).
//   "native"      -> one of Herbiose's own native app shells
//   "same-origin" -> a normal request from the app's own deployed origin
//   null          -> neither; caller must reject
export function classifyOrigin(origin, host) {
  if (!origin) return null;
  if (ALLOWED_NATIVE_ORIGINS.has(origin)) return "native";
  if (!host) return null;
  try {
    return new URL(origin).host === host ? "same-origin" : null;
  } catch {
    return null;
  }
}

// Fallback for requests with no Origin header at all. Same-origin only —
// Referer can't safely stand in for the native-origin allowlist, so a
// missing Origin from a native shell is never granted access this way.
export function isSameOriginReferer(referer, host) {
  if (!referer || !host) return false;
  try {
    return new URL(referer).host === host;
  } catch {
    return false;
  }
}
