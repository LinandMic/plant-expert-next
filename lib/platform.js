// Shared native-platform detection and web-origin configuration.
//
// This is Phase 0 plumbing for the native iOS/Android (Capacitor) migration.
// @capacitor/core is NOT installed yet, so isNativePlatform() below does not
// import it — importing an uninstalled package would break the current web
// build. Instead it does runtime feature detection against the globals
// Capacitor injects into `window` when it bootstraps a native WebView shell.
//
// Once @capacitor/core is installed (a later phase), replace the body of
// isNativePlatform() with:
//
//   import { Capacitor } from "@capacitor/core";
//   export const isNativePlatform = () => Capacitor.isNativePlatform();
//
// Every call site should keep importing isNativePlatform() from this module
// so that swap is the only change required.

export function isNativePlatform() {
  if (typeof window === "undefined") {
    return false;
  }
  const capacitor = window.Capacitor;
  return typeof capacitor?.isNativePlatform === "function"
    ? capacitor.isNativePlatform()
    : false;
}

// Canonical public HTTPS origin of the web deployment (e.g.
// "https://app.example.com", no trailing slash). Future native-redirect
// code (Supabase auth redirects, deep links, etc.) will read this instead
// of window.location.origin, since window.location.origin is not a usable
// HTTPS origin inside a native WebView (it's "capacitor://localhost" or
// similar there).
//
// Not consumed anywhere yet in this phase — introducing the env var and a
// safe accessor now so later phases have one canonical place to read it
// from. Falls back to null (not a guessed URL) when unset.
export function getWebOrigin() {
  return process.env.NEXT_PUBLIC_WEB_ORIGIN ?? null;
}
