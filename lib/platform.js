// Shared native-platform detection and web-origin configuration.
//
// @capacitor/core IS installed (a dependency of @capacitor/camera and
// @capacitor/app), but isNativePlatform() below intentionally still does
// NOT import it directly. Two reasons, checked against the installed
// package (node_modules/@capacitor/core/dist/index.js), not assumed:
//
//   1. Importing "@capacitor/core" runs its module-scope
//      createCapacitor(win) immediately, which *assigns* `win.Capacitor`
//      if not already present. In a plain web build that would plant a
//      new `window.Capacitor` global on every page load that never
//      existed before — an observable, unwanted change to normal web
//      behavior, even though it's functionally inert there.
//   2. The native WebView shell injects `window.Capacitor` itself before
//      any app JS runs, so reading it at runtime (below) is sufficient to
//      detect native platforms without ever importing the package into
//      the shared web bundle.
//
// So this stays runtime feature detection against the `window.Capacitor`
// global the native shell injects, rather than an import.

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
// "https://app.example.com", no trailing slash). Native-redirect code
// reads this instead of window.location.origin, since window.location.origin
// is not a usable HTTPS origin inside a native WebView (it's
// "capacitor://localhost" or similar there). Consumed by
// lib/authRedirect.js (password-reset redirectTo) and lib/nativeDeepLink.js
// (incoming-URL allowlist). Falls back to null (not a guessed URL) when
// unset.
export function getWebOrigin() {
  return process.env.NEXT_PUBLIC_WEB_ORIGIN ?? null;
}
