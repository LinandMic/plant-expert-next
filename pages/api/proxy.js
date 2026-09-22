// Server-side Anthropic proxy for ALMEO.
//
// Security / monetization contract:
// - accepts only ALMEO same-origin web requests or the exact native
//   Capacitor origins already defined in lib/apiOrigin.js;
// - requires a verified Supabase access token;
// - derives the user id only from that verified token;
// - consumes exactly one AI credit atomically before the paid Anthropic
//   call;
// - refunds that credit idempotently if Anthropic fails before a usable
//   response is returned;
// - records Anthropic token usage server-side for real per-user cost
//   measurement without exposing service-role credentials to the client.
import { randomUUID } from "node:crypto";
import { classifyOrigin, isSameOriginReferer } from "../../lib/apiOrigin.js";
import { createSupabaseAdminClient, getSupabaseAdminConfig } from "../../lib/supabaseAdmin.js";

const ALLOWED_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS_CAP = 8000;
const CORS_ALLOWED_METHODS = "POST";
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
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

export function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match ? match[1].trim() : "";
  return token || null;
}

function nonNegativeIntegerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function recordUsage(admin, row) {
  try {
    const { error } = await admin.from("ai_analysis_usage").insert(row);
    if (error) throw error;
  } catch (error) {
    // Metering must never turn a successful analysis into a user-facing
    // failure. The paid call/credit state remains authoritative; this log
    // makes any telemetry gap visible for later reconciliation.
    console.error("proxy: failed to record AI usage:", error.message);
  }
}

async function refundCredit(admin, userId, requestId) {
  try {
    const { data, error } = await admin.rpc("refund_ai_credit", {
      target_user_id: userId,
      request_key: requestId,
    });
    if (error) throw error;
    return Boolean(data && data.ok);
  } catch (error) {
    console.error("proxy: AI credit refund failed:", error.message);
    return false;
  }
}

export function createProxyHandler({
  getAdminClient = defaultGetAdminClient,
  fetchImpl = (...args) => fetch(...args),
  makeRequestId = () => randomUUID(),
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
    if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token", code: "AUTH_REQUIRED" });
    }

    let admin;
    try {
      admin = getAdminClient();
    } catch (error) {
      console.error("proxy: admin client unavailable:", error.message);
      return res.status(500).json({ error: "Analysis is not available right now." });
    }

    let userId;
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data || !data.user) {
        return res.status(401).json({ error: "Invalid or expired session", code: "AUTH_REQUIRED" });
      }
      userId = data.user.id;
    } catch (error) {
      console.error("proxy: token verification failed:", error.message);
      return res.status(401).json({ error: "Invalid or expired session", code: "AUTH_REQUIRED" });
    }

    const requestId = makeRequestId();

    let consumption;
    try {
      const { data, error } = await admin.rpc("consume_ai_credit", {
        target_user_id: userId,
        request_key: requestId,
      });
      if (error) throw error;
      consumption = data;
    } catch (error) {
      console.error("proxy: failed to consume AI credit:", error.message);
      return res.status(500).json({ error: "Analysis is not available right now." });
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
      console.error("proxy: monetization state missing for authenticated user");
      return res.status(500).json({ error: "Analysis is not available right now." });
    }

    const creditSource = consumption.credit_source || null;
    const requestedMaxTokens = Number(body.max_tokens);
    const max_tokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
      ? Math.min(requestedMaxTokens, MAX_TOKENS_CAP)
      : MAX_TOKENS_CAP;

    const upstreamBody = {
      model: ALLOWED_MODEL,
      max_tokens,
      messages: [...body.messages, { role: "assistant", content: "{" }],
    };
    if (typeof body.system === "string") {
      upstreamBody.system = body.system;
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
      console.error("Anthropic proxy error:", error);
      const refunded = await refundCredit(admin, userId, requestId);
      await recordUsage(admin, {
        request_id: requestId,
        user_id: userId,
        model: ALLOWED_MODEL,
        status: refunded ? "refunded" : "refund_failed",
        credit_source: creditSource,
        upstream_status: null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      });
      return res.status(502).json({ error: "Upstream request failed" });
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.error("proxy: invalid Anthropic JSON response:", error.message);
      const refunded = await refundCredit(admin, userId, requestId);
      await recordUsage(admin, {
        request_id: requestId,
        user_id: userId,
        model: ALLOWED_MODEL,
        status: refunded ? "refunded" : "refund_failed",
        credit_source: creditSource,
        upstream_status: response.status || null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      });
      return res.status(502).json({ error: "Upstream request failed" });
    }

    if (!response.ok) {
      const refunded = await refundCredit(admin, userId, requestId);
      const usage = data && typeof data.usage === "object" ? data.usage : {};
      await recordUsage(admin, {
        request_id: requestId,
        user_id: userId,
        model: ALLOWED_MODEL,
        status: refunded ? "refunded" : "refund_failed",
        credit_source: creditSource,
        upstream_status: response.status || null,
        input_tokens: nonNegativeIntegerOrNull(usage.input_tokens),
        output_tokens: nonNegativeIntegerOrNull(usage.output_tokens),
        cache_creation_input_tokens: nonNegativeIntegerOrNull(usage.cache_creation_input_tokens),
        cache_read_input_tokens: nonNegativeIntegerOrNull(usage.cache_read_input_tokens),
      });
      return res.status(response.status || 502).json(data);
    }

    if (!data || !Array.isArray(data.content) || !data.content[0] || typeof data.content[0].text !== "string") {
      const refunded = await refundCredit(admin, userId, requestId);
      await recordUsage(admin, {
        request_id: requestId,
        user_id: userId,
        model: ALLOWED_MODEL,
        status: refunded ? "refunded" : "refund_failed",
        credit_source: creditSource,
        upstream_status: response.status || null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      });
      return res.status(502).json({ error: "Upstream response was incomplete" });
    }

    data.content[0].text = "{" + data.content[0].text;

    const usage = data && typeof data.usage === "object" ? data.usage : {};
    await recordUsage(admin, {
      request_id: requestId,
      user_id: userId,
      model: ALLOWED_MODEL,
      status: "succeeded",
      credit_source: creditSource,
      upstream_status: response.status || 200,
      input_tokens: nonNegativeIntegerOrNull(usage.input_tokens),
      output_tokens: nonNegativeIntegerOrNull(usage.output_tokens),
      cache_creation_input_tokens: nonNegativeIntegerOrNull(usage.cache_creation_input_tokens),
      cache_read_input_tokens: nonNegativeIntegerOrNull(usage.cache_read_input_tokens),
    });

    return res.status(response.status).json(data);
  };
}

export default createProxyHandler();
