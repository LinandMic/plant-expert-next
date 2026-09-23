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
//   "first messages" from double-charging. Follow-up messages in the
//   same still-active session consume no additional credit.
// - session lifecycle/limits are enforced authoritatively server-side,
//   and made safe under CONCURRENT requests, via an explicit reserve /
//   reconcile / release protocol against the ai_chat_sessions table (see
//   that migration's own comment for the full argument):
//     1. reserve_chat_message — BEFORE calling Anthropic, atomically
//        validates the session AND reserves message-count/token capacity
//        together, under one row lock. This is what actually prevents
//        two concurrent requests for the same session from both passing
//        the 10-message/20k-token check before either's usage lands —
//        a separate "check, then later increment" (the previous
//        revision's design) could not guarantee that, because the check
//        and the increment were in different transactions with a slow
//        Anthropic call in between.
//     2. reconcile_chat_message — AFTER a successful reply, atomically
//        replaces the reservation's conservative token estimate with
//        Anthropic's real usage, records the credit charge, and closes
//        the session if a limit is now reached. Idempotent.
//     3. release_chat_message_reservation — used only for a LATER
//        (non-credit-charging) message whose call failed, so a failed
//        attempt never permanently costs part of the session's budget.
//        Idempotent.
// - if the FIRST Anthropic call of a newly-charged session fails, the
//   credit is refunded and the session permanently closed — with
//   close_reason "first_call_refunded" if the refund itself succeeded,
//   or "first_call_refund_failed" if it did NOT (a durable, queryable
//   fact instead of only a server log line — see FIX 4). Either way the
//   client must mint a new session id to retry. If a LATER message fails
//   after at least one successful reply, nothing is refunded, the
//   reservation is released, and the session stays open for a retry.
// - every Anthropic call attempt (success or failure) is durably logged
//   to ai_chat_usage — model, tokens, status — never message/prompt
//   content. A reconcile failure after a successful reply is ALSO logged
//   there (status "reconcile_failed") rather than only console.error'd,
//   so it is not silently lost.
// - returns plain conversational text — no JSON-prefill trick, unlike
//   proxy.js.
import { classifyOrigin, isSameOriginReferer } from "../../lib/apiOrigin.js";
import { createSupabaseAdminClient, getSupabaseAdminConfig } from "../../lib/supabaseAdmin.js";
import { CHAT_MODEL, CHAT_SESSION_LIMITS, CHAT_USAGE_STATUS } from "../../lib/chatConfig.js";
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

function nonNegativeIntOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nonNegativeIntOrZero(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// validateMessages(rawMessages) -> { ok, messages, error }
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

    // --- FIX 1: atomic reservation, replacing the old check-then-later-
    // increment. This single RPC call validates ownership/status/
    // inactivity AND reserves message-count/token capacity together,
    // under one row lock, so it cannot be raced by a concurrent request
    // for the same session id.
    const inactivitySeconds = Math.round(CHAT_SESSION_LIMITS.INACTIVITY_TIMEOUT_MS / 1000);

    let reservation;
    try {
      const { data, error } = await admin.rpc("reserve_chat_message", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_inactivity_timeout_seconds: inactivitySeconds,
        p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES,
        p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
        p_estimated_tokens: CHAT_SESSION_LIMITS.RESERVATION_TOKEN_ESTIMATE,
      });
      if (error) throw error;
      reservation = data;
    } catch (error) {
      console.error("chat: failed to reserve message slot:", error.message);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }

    if (!reservation || reservation.ok !== true) {
      const code = (reservation && reservation.code) || "SESSION_STATE_MISSING";
      if (code === "FORBIDDEN") return res.status(403).json({ error: "Forbidden", code });
      if (code === "SESSION_CLOSED") {
        return res.status(409).json({ error: "Session closed", code, close_reason: reservation.close_reason });
      }
      console.error("chat: unexpected reserve_chat_message state:", code);
      return res.status(500).json({ error: "Assistant is not available right now." });
    }

    const reservationId = reservation.reservation_id;
    const isFirstChargeAttempt = reservation.credit_charged !== true;
    let creditSource = null;

    async function releaseReservation() {
      try {
        const { error } = await admin.rpc("release_chat_message_reservation", {
          p_session_id: sessionId,
          p_user_id: userId,
          p_reservation_id: reservationId,
        });
        if (error) throw error;
      } catch (error) {
        console.error("chat: failed to release reservation:", error.message);
      }
    }

    // --- FIX 3: durable per-call telemetry — model/tokens/status only,
    // never message or prompt content. Logged only for outcomes of an
    // actual (or attempted) Anthropic call; NO_CREDITS/FORBIDDEN/
    // SESSION_CLOSED/invalid-body never reach here, since no cost was
    // incurred and nothing needs reconciling for them.
    async function recordUsage(row) {
      try {
        const { error } = await admin.from("ai_chat_usage").insert({
          reservation_id: reservationId,
          session_id: sessionId,
          user_id: userId,
          model: CHAT_MODEL,
          is_first_message: isFirstChargeAttempt,
          credit_source: creditSource,
          ...row,
        });
        if (error) throw error;
      } catch (error) {
        console.error("chat: failed to record chat usage telemetry:", error.message);
      }
    }

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
        await releaseReservation();
        return res.status(500).json({ error: "Assistant is not available right now." });
      }

      if (!consumption || consumption.ok !== true) {
        await releaseReservation();
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

    // --- FIX 4: refund failure is durable, not just a console.error. The
    // session is ALWAYS permanently closed after a first-call failure
    // (never left refundable-and-reusable), but the close_reason records
    // whether the refund itself actually succeeded, and a telemetry row
    // is written either way so a lost credit is queryable, not only
    // logged.
    async function handleFirstCallFailure(upstreamStatus) {
      const refunded = await refundCredit(admin, userId, sessionId);
      const closeReason = refunded ? "first_call_refunded" : "first_call_refund_failed";
      await closeSessionPermanently(admin, userId, sessionId, closeReason);
      await recordUsage({
        status: refunded ? CHAT_USAGE_STATUS.REFUNDED : CHAT_USAGE_STATUS.REFUND_FAILED,
        upstream_status: upstreamStatus,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      });
      return refunded;
    }

    async function handleLaterCallFailure(upstreamStatus) {
      await releaseReservation();
      await recordUsage({
        status: CHAT_USAGE_STATUS.UPSTREAM_FAILED,
        upstream_status: upstreamStatus,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      });
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
      if (isFirstChargeAttempt) await handleFirstCallFailure(null);
      else await handleLaterCallFailure(null);
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
      if (isFirstChargeAttempt) await handleFirstCallFailure(response.status || null);
      else await handleLaterCallFailure(response.status || null);
      return res.status(502).json({
        error: "Upstream request failed",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    if (!response.ok) {
      if (isFirstChargeAttempt) await handleFirstCallFailure(response.status || null);
      else await handleLaterCallFailure(response.status || null);
      return res.status(response.status || 502).json({
        error: "Upstream request failed",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    if (!data || !Array.isArray(data.content) || !data.content[0] || typeof data.content[0].text !== "string") {
      if (isFirstChargeAttempt) await handleFirstCallFailure(response.status || null);
      else await handleLaterCallFailure(response.status || null);
      return res.status(502).json({
        error: "Upstream response was incomplete",
        code: isFirstChargeAttempt ? "FIRST_MESSAGE_FAILED" : "MESSAGE_FAILED",
      });
    }

    const assistantText = data.content[0].text;
    const usage = data && typeof data.usage === "object" ? data.usage : {};
    const inputTokens = nonNegativeIntOrZero(usage.input_tokens);
    const outputTokens = nonNegativeIntOrZero(usage.output_tokens);
    const cacheCreationTokens = nonNegativeIntOrNull(usage.cache_creation_input_tokens);
    const cacheReadTokens = nonNegativeIntOrNull(usage.cache_read_input_tokens);
    const tokenCount = inputTokens + outputTokens;

    // --- FIX 2: reconciliation, with a durable trace on failure instead
    // of a bare console.error. A successful, paid-for, delivered reply
    // must never silently vanish from authoritative accounting — if
    // reconcile_chat_message itself errors, that failure is written to
    // ai_chat_usage (status "reconcile_failed") with the reservation id
    // and actual token usage preserved, so it can be found and
    // reconciled later, rather than only appearing in a server log.
    let sessionResult;
    let reconcileFailed = false;
    try {
      const { data: reconcileData, error } = await admin.rpc("reconcile_chat_message", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_reservation_id: reservationId,
        p_actual_tokens: tokenCount,
        p_credit_charged: isFirstChargeAttempt,
        p_credit_source: creditSource,
        p_max_user_messages: CHAT_SESSION_LIMITS.MAX_USER_MESSAGES,
        p_max_cumulative_tokens: CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS,
      });
      if (error) throw error;
      sessionResult = reconcileData;
    } catch (error) {
      console.error("chat: failed to reconcile message result:", error.message);
      reconcileFailed = true;
      sessionResult = null;
    }

    await recordUsage({
      status: reconcileFailed ? CHAT_USAGE_STATUS.RECONCILE_FAILED : CHAT_USAGE_STATUS.SUCCEEDED,
      upstream_status: response.status || 200,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    });

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
