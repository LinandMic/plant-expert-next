// ALMEO Conversational Assistant V1 — server-side chat endpoint.
//
// A deliberately SEPARATE endpoint from pages/api/proxy.js (never
// modified by this feature — see AGENTS.md / the V1 spec). Some request-
// scaffolding (origin check, bearer-token verification) is intentionally
// duplicated rather than shared, to keep zero regression risk on the
// shipped, monetized plant-identification path.
//
// Security / monetization contract:
// - accepts only ALMEO same-origin web requests or the exact native
//   Capacitor origins already defined in lib/apiOrigin.js (identical
//   policy to proxy.js);
// - requires a verified Supabase access token; the user id is derived
//   ONLY from that verified token, never from the request body;
// - "one AI credit = one chat session": the FIRST user message of a
//   session consumes exactly one existing consume_ai_credit() call,
//   keyed on the session id itself as the idempotent request_key — so
//   the credit RPC's own row-locking already prevents two concurrent
//   "first messages" from double-charging (see the migration's own
//   comment for the full argument). Follow-up messages in the same still-
//   active session consume no additional credit.
// - session lifecycle/limits are enforced authoritatively server-side via
//   the ai_chat_sessions table and its open_chat_session /
//   record_chat_message_result / close_chat_session RPCs (see that
//   migration) — never trusted from the client, never kept in process
//   memory (serverless instances are not stable session storage).
// - if the FIRST Anthropic call of a newly-charged session fails before a
//   usable reply, the credit is refunded and the session is permanently
//   closed (close_reason "first_call_refunded"); the client must mint a
//   new session id to retry. If a LATER message fails after at least one
//   successful reply, nothing is refunded and the session stays open for
//   a retry.
// - returns plain conversational text — no JSON-prefill trick, unlike
//   proxy.js.
import { classifyOrigin, isSameOriginReferer } from "../../lib/apiOrigin.js";
import { createSupabaseAdminClient, getSupabaseAdminConfig } from "../../lib/supabaseAdmin.js";
import { CHAT_MODEL, CHAT_SESSION_LIMITS } from "../../lib/chatConfig.js";
import { resolveChatContext } from "../../lib/chatContext.js";
import { buildChatSystemPrompt } from "../../lib/chatSystemPrompt.js";

const CORS_ALLOWED_METHODS = "POST";
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "512kb",
    },
  },
};

function defaultGetAdminClient() {
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig.hasUrl || !adminConfig.hasServiceRoleKey) {
    throw new Error(
      "Supabase admin credentials are not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return createSupabaseAdminClient(adminConfig);
}

// Mirrors pages/api/proxy.js's own extractBearerToken exactly — kept as a
// separate copy rather than a shared import, per the "small amount of
// request-scaffolding duplication is preferable to regression risk in the
// shipped identification path" instruction.
function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match ? match[1].trim() : "";
  return token || null;
}

function nonNegativeIntOrZero(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// validateMessages(rawMessages) -> { ok, messages, lastUserText, error }
// Whitelists shape only: an array of { role: "user"|"assistant", content:
// <string> } — never image/multimodal blocks (this endpoint is text-only
// in V1), bounded in count and in the latest user turn's length.
function validateMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, error: "INVALID_BODY" };
  }
  if (rawMessages.length > CHAT_SESSION_LIMITS.MAX_TRANSCRIPT_MESSAGES) {
    return { ok: false, error: "TRANSCRIPT_TOO_LONG" };
  }
  const messages = [];
  for (const entry of rawMessages) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "INVALID_BODY" };
    if (entry.role !== "user" && entry.role !== "assistant") return { ok: false, error: "INVALID_BODY" };
    if (typeof entry.content !== "string" || entry.content.trim() === "") {
      return { ok: false, error: "INVALID_BODY" };
    }
    messages.push({ role: entry.role, content: entry.content });
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") return { ok: false, error: "INVALID_BODY" };
  if (last.content.length > CHAT_SESSION_LIMITS.MAX_USER_MESSAGE_LENGTH) {
    return { ok: false, error: "MESSAGE_TOO_LONG" };
  }
  return { ok: true, messages };
}

async function refundCredit(admin, userId, sessionId) {
  try {
    const { data, error } = await admin.rpc("refund_ai_credit", {
      target_user_id: userId,
      request_key: sessionId,
    });
    if (error) throw error;
    return Boolean(data && data.ok);
  } catch (error) {
    console.error("chat: AI credit refund failed:", error.message);
    return false;
  }
}

async function closeSessionPermanently(admin, userId, sessionId, reason) {
  try {
    const { error } = await admin.rpc("close_chat_session", {
      p_session_id: sessionId,
      p_user_id: userId,
      p_close_reason: reason,
    });
    if (error) throw error;
  } catch (error) {
    console.error("chat: failed to close session:", error.message);
  }
}

export function createChatHandler({
  getAdminClient = defaultGetAdminClient,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async function handler(req, res) {
    const host = req.headers.host;
    const originHeader = req.headers.origin;
    const originClass = classifyOrigin(originHeader, host);

    if (originClass === "native") {
      res.setHeader("Access-Control-Allow-Origin", originHeader);
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      if (originClass === "native") {
        res.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
        res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
      }
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const isAllowedOrigin =
      originClass === "native" ||
      originClass === "same-origin" ||
      (!originHeader && isSameOriginReferer(req.headers.referer, host));

    if (!isAllowedOrigin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || typeof body.session_id !== "string" || !UUID_RE.test(body.session_id)) {
      return res.status(400).json({ error: "Invalid request body", code: "INVALID_BODY" });
    }
    const sessionId = body.session_id;

    const messagesResult = validateMessages(body.messages);
    if (!messagesResult.ok) {
      return res.status(400).json({ error: "Invalid request body", code: messagesResult.error });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token", code: "AUTH_REQUIRED" });
    }

    let admin;
    try {
      admin = getAdminClient();
    } catch (error) {
      console.error("chat: admin client unavailable:", error.message);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }

    let userId;
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data || !data.user) {
        return res.status(401).json({ error: "Invalid or expired session", code: "AUTH_REQUIRED" });
      }
      userId = data.user.id;
    } catch (error) {
      console.error("chat: token verification failed:", error.message);
      return res.status(401).json({ error: "Invalid or expired session", code: "AUTH_REQUIRED" });
    }

    let resolvedContext;
    try {
      resolvedContext = await resolveChatContext({ admin, userId, rawContext: body.context });
    } catch (error) {
      console.error("chat: context resolution failed:", error.message);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }
    if (resolvedContext.error) {
      const status = resolvedContext.error === "NOT_FOUND" ? 404 : 400;
      return res.status(status).json({ error: "Invalid context", code: resolvedContext.error });
    }

    const inactivitySeconds = Math.round(CHAT_SESSION_LIMITS.INACTIVITY_TIMEOUT_MS / 1000);

    let sessionState;
    try {
      const { data, error } = await admin.rpc("open_chat_session", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_inactivity_timeout_seconds: inactivitySeconds,
        p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES,
        p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
      });
      if (error) throw error;
      sessionState = data;
    } catch (error) {
      console.error("chat: failed to open session:", error.message);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }

    if (!sessionState || sessionState.ok !== true) {
      const code = (sessionState && sessionState.code) || "SESSION_STATE_MISSING";
      if (code === "FORBIDDEN") return res.status(403).json({ error: "Forbidden", code });
      if (code === "SESSION_CLOSED") {
        return res.status(409).json({ error: "Session closed", code, close_reason: sessionState.close_reason });
      }
      console.error("chat: unexpected open_chat_session state:", code);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }

    const isFirstChargeAttempt = sessionState.credit_charged !== true;
    let creditSource = null;

    if (isFirstChargeAttempt) {
      let consumption;
      try {
        const { data, error } = await admin.rpc("consume_ai_credit", {
          target_user_id: userId,
          request_key: sessionId,
        });
        if (error) throw error;
        consumption = data;
      } catch (error) {
        console.error("chat: failed to consume AI credit:", error.message);
        return res.status(500).json({ error: "Assistant is not available right now." });
      }

      if (!consumption || consumption.ok !== true) {
        if (consumption && consumption.code === "NO_CREDITS") {
          return res.status(402).json({
            error: "NO_CREDITS",
            code: "NO_CREDITS",
            included_credits: consumption.included_credits ?? 0,
            purchased_credits: consumption.purchased_credits ?? 0,
          });
        }
        console.error("chat: monetization state missing for authenticated user");
        return res.status(500).json({ error: "Assistant is not available right now." });
      }
      creditSource = consumption.credit_source || null;
    }

    const systemPrompt = buildChatSystemPrompt(resolvedContext);
    const upstreamBody = {
      model: CHAT_MODEL,
      max_tokens: CHAT_SESSION_LIMITS.MAX_OUTPUT_TOKENS_PER_MESSAGE,
      system: systemPrompt,
      messages: messagesResult.messages,
    };

    async function handleFirstCallFailure() {
      const refunded = await refundCredit(admin, userId, sessionId);
      await closeSessionPermanently(admin, userId, sessionId, "first_call_refunded");
      return refunded;
    }

    let response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch (error) {
      console.error("chat: Anthropic request failed:", error);
      if (isFirstChargeAttempt) await handleFirstCallFailure();
      return res.status(502).json({
        error: "Upstream request failed",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.error("chat: invalid Anthropic JSON response:", error.message);
      if (isFirstChargeAttempt) await handleFirstCallFailure();
      return res.status(502).json({
        error: "Upstream request failed",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    if (!response.ok) {
      if (isFirstChargeAttempt) await handleFirstCallFailure();
      return res.status(response.status || 502).json({
        error: "Upstream request failed",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    if (!data || !Array.isArray(data.content) || !data.content[0] || typeof data.content[0].text !== "string") {
      if (isFirstChargeAttempt) await handleFirstCallFailure();
      return res.status(502).json({
        error: "Upstream response was incomplete",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    const assistantText = data.content[0].text;
    const usage = data && typeof data.usage === "object" ? data.usage : {};
    const tokenCount = nonNegativeIntOrZero(usage.input_tokens) + nonNegativeIntOrZero(usage.output_tokens);

    let sessionResult;
    try {
      const { data: recordData, error } = await admin.rpc("record_chat_message_result", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_credit_charged: isFirstChargeAttempt,
        p_credit_source: creditSource,
        p_token_count: tokenCount,
        p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES,
        p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
      });
      if (error) throw error;
      sessionResult = recordData;
    } catch (error) {
      // The reply already succeeded and must reach the user — a metering
      // failure here must never turn a successful reply into a user-facing
      // error, same principle as proxy.js's recordUsage().
      console.error("chat: failed to record message result:", error.message);
      sessionResult = null;
    }

    return res.status(200).json({
      session_id: sessionId,
      message: { role: "assistant", content: assistantText },
      session: sessionResult
        ? {
            status: sessionResult.status,
            close_reason: sessionResult.close_reason,
            user_message_count: sessionResult.user_message_count,
            cumulative_tokens: sessionResult.cumulative_tokens,
          }
        : null,
    });
  };
}

export default createChatHandler();
