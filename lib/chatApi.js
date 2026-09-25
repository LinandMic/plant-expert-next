// Explicit ".js" extensions: loaded directly by plain `node --test` via
// lib/chatApi.test.js — same reasoning as lib/accountApi.js.
//
// Client-side helper for the ALMEO Conversational Assistant. Mirrors
// lib/accountApi.js's injectable-factory shape (createChatClient({
// getSupabase, isNative, webOrigin, fetchImpl, generateId }) -> { ... })
// so the request-building logic is unit-testable against a fake Supabase
// client and a stubbed fetch, with zero real network calls. The default
// export is the real, production-wired instance.
import { supabase } from "./supabaseClient.js";
import { isNativePlatform, getWebOrigin } from "./platform.js";

function defaultGenerateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return null;
}

export function createChatClient({
  getSupabase = () => supabase,
  isNative = isNativePlatform,
  webOrigin = getWebOrigin,
  fetchImpl,
  generateId = defaultGenerateId,
} = {}) {
  // Same reasoning as lib/accountApi.js's resolveUrl(): the native app is
  // a static export with no local "/api/*" routes to resolve against.
  function resolveUrl() {
    if (!isNative()) return "/api/chat";
    const origin = webOrigin();
    if (!origin) {
      throw new Error("NEXT_PUBLIC_WEB_ORIGIN is not configured — the native app cannot reach /api/chat without it.");
    }
    return `${origin}/api/chat`;
  }

  // createSessionId() -> a fresh opaque session id, minted once when the
  // user starts a NEW conversation (or reuses the current one for every
  // follow-up message in it — see components/ChatModal.js). Never derived
  // from anything server-controlled; the server treats it purely as an
  // idempotency/ownership key, never as identity.
  function createSessionId() {
    const id = generateId();
    if (!id) throw new Error("Unable to generate a chat session id.");
    return id;
  }

  // sendMessage({ sessionId, messages, context }) ->
  //   { ok: true, data: { session_id, message, session } }
  //   | { ok: false, errorCode, status?, data? }
  // `messages` is the full running transcript (V1 never persists it
  // server-side — see the spec's chat-content-persistence section), each
  // entry { role: "user"|"assistant", content: <string> }. `context` is
  // the small, optional { mode, plantId? , identification? } payload —
  // server-validated/whitelisted, see lib/chatContext.js.
  async function sendMessage({ sessionId, messages, context } = {}) {
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
        body: JSON.stringify({ session_id: sessionId, messages, context }),
      });
    } catch {
      return { ok: false, errorCode: "network" };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorCode = (data && data.code) || "generic";
      return { ok: false, errorCode, status: response.status, data };
    }

    return { ok: true, data };
  }

  return { createSessionId, sendMessage, resolveUrl };
}

export const { createSessionId, sendMessage } = createChatClient();
