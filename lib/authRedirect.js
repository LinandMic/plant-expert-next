// Pure, unit-testable password-reset redirect URL construction.
//
// Web: unchanged existing behavior — same-origin, built from
// window.location.origin.
//
// Native: must NEVER use the local WebView origin (capacitor://localhost /
// https://localhost, see lib/apiOrigin.js) as redirectTo — that origin
// isn't reachable from the email client that opens the reset link, and
// Supabase's own recovery hash tokens need a real HTTPS origin the native
// deep-link handler (lib/nativeDeepLink.js) can later recognize and hand
// back to the app. Always built from NEXT_PUBLIC_WEB_ORIGIN
// (lib/platform.js's getWebOrigin()) — never hardcoded here.
//
// This function takes its inputs explicitly (isNative/webOrigin/
// windowOrigin) rather than reading platform.js/window itself, so it is
// testable in plain Node with no DOM/Capacitor globals.
export function resolvePasswordResetRedirect({ isNative, webOrigin, windowOrigin }) {
  if (isNative) {
    let originUrl;
    try {
      originUrl = webOrigin ? new URL(webOrigin) : null;
    } catch {
      originUrl = null;
    }
    if (!originUrl || originUrl.protocol !== "https:") {
      return { error: "Configuration native invalide : NEXT_PUBLIC_WEB_ORIGIN est manquant ou invalide." };
    }
    return { redirectTo: new URL("/reset-password", originUrl).toString() };
  }

  if (!windowOrigin) return { redirectTo: undefined };
  return { redirectTo: `${windowOrigin}/reset-password` };
}
