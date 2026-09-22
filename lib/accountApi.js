// Explicit ".js" extensions (unlike most of this codebase's "@/" or
// bare-relative imports): this module is loaded directly by plain
// `node --test` via lib/accountApi.test.js, which only understands
// Node's native ESM resolution — same reasoning as pages/api/proxy.js's
// own relative-with-extension import of lib/apiOrigin.js.
import { supabase } from "./supabaseClient.js";
import { isNativePlatform, getWebOrigin } from "./platform.js";

// createAccountDeleteClient(deps) -> { deleteAccount } — injectable
// factory so the request-building/error-classification logic can be unit
// tested against a fake Supabase client and a stubbed fetch, with zero
// real network calls and no dependency on the module-level `supabase`
// singleton (which is null outside a browser/env-configured context). The
// default export below is the real, production-wired instance — see
// lib/accountApi.test.js.
export function createAccountDeleteClient({
  getSupabase = () => supabase,
  isNative = isNativePlatform,
  webOrigin = getWebOrigin,
  fetchImpl,
} = {}) {
  // The native app is a static export with no local "/api/*" routes to
  // resolve against — mirrors pages/index.js's own resolveProxyUrl() for
  // the exact same reason (see that file's comment). Missing config fails
  // loudly rather than silently hitting a broken local URL.
  function resolveUrl() {
    if (!isNative()) return "/api/account/delete";
    const origin = webOrigin();
    if (!origin) {
      throw new Error(
        "NEXT_PUBLIC_WEB_ORIGIN is not configured — the native app cannot reach /api/account/delete without it."
      );
    }
    return `${origin}/api/account/delete`;
  }

  // deleteAccount() -> { ok: boolean, errorCode?: "session_expired" | "network" | "generic" }
  // Never sends a userId (the server derives identity from the bearer
  // token alone) and never logs the access token. errorCode is a stable
  // machine-readable reason for the caller to pick an i18n message from —
  // never a raw server/error string surfaced to the UI.
  async function deleteAccount() {
    const client = getSupabase();
    if (!client) return { ok: false, errorCode: "generic" };

    let accessToken = null;
    try {
      const { data } = await client.auth.getSession();
      accessToken = data && data.session ? data.session.access_token : null;
    } catch {
      accessToken = null;
    }
    if (!accessToken) return { ok: false, errorCode: "session_expired" };

    let url;
    try {
      url = resolveUrl();
    } catch {
      return { ok: false, errorCode: "generic" };
    }

    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) return { ok: false, errorCode: "generic" };

    let response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      return { ok: false, errorCode: "network" };
    }

    if (!response.ok) return { ok: false, errorCode: "generic" };
    return { ok: true };
  }

  return { deleteAccount };
}

export const { deleteAccount } = createAccountDeleteClient();
