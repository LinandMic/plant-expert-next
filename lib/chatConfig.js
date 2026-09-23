// Single source of truth for ALMEO Conversational Assistant V1's session
// limits and model choice. pages/api/chat.js, the ai_chat_sessions RPCs
// (called with these values as explicit arguments — never duplicated as
// hardcoded numbers in SQL), and lib/chatApi.js all read from here so the
// product rule ("one AI credit = one chat session, bounded by these
// limits") has exactly one place it's defined.
//
// V1 product rule (see the ALMEO Conversational Assistant V1 spec):
//   - first user message in a session consumes exactly one AI credit;
//   - follow-up messages in the same still-active session consume none;
//   - the session closes (no further messages) once any limit below is
//     reached, and the UI must offer to start a new conversation, which
//     mints a new session id and consumes a new credit on its first
//     message.

// Kept as its own literal (not imported from pages/api/proxy.js) because
// AGENTS.md / the V1 spec both forbid touching proxy.js, even to export a
// shared constant. Must stay equal to proxy.js's own ALLOWED_MODEL unless
// a future inspection finds that model invalid/unavailable — V1
// deliberately does not opportunistically upgrade it.
export const CHAT_MODEL = "claude-sonnet-4-5";

export const CHAT_SESSION_LIMITS = Object.freeze({
  // Maximum number of USER messages (not counting assistant replies) a
  // single session may contain before it closes.
  MAX_USER_MESSAGES: 10,

  // A session with no activity for this long closes on the next request
  // that touches it (checked server-side against last_activity_at —
  // never enforced by a client-side timer alone).
  INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,

  // Cumulative input+output tokens (summed across every message in the
  // session, from Anthropic's own reported usage) after which the
  // session closes, independent of the message count.
  MAX_CUMULATIVE_TOKENS: 20000,

  // Anthropic `max_tokens` for a single assistant reply. Bounds per-
  // message cost independent of the session-wide token budget above.
  MAX_OUTPUT_TOKENS_PER_MESSAGE: 1200,

  // Hard cap on one user message's text length (characters), checked
  // server-side before the message is ever sent upstream.
  MAX_USER_MESSAGE_LENGTH: 2000,

  // Defensive cap on how many transcript entries (user+assistant turns
  // combined) a single request may resend. V1 never persists the
  // transcript server-side (see the spec's "chat content persistence"
  // section) — the client resends the running conversation each call —
  // so this bounds how much a single request can pad the upstream call
  // regardless of the server-side per-session message count above.
  MAX_TRANSCRIPT_MESSAGES: 2 * 10 + 2,

  // Conservative token allowance reserved atomically (via
  // reserve_chat_message) BEFORE the Anthropic call, so the message-count
  // and cumulative-token limits can never be raced past by concurrent
  // requests for the same session — the check and the reservation happen
  // together, under one row lock, in a single RPC. Reconciled down to the
  // real value (reconcile_chat_message) once Anthropic's actual usage is
  // known. Deliberately a simple fixed constant rather than a precise
  // tokenizer estimate — "smallest robust solution", not perfect
  // prediction; being conservative here means a session can close
  // slightly earlier than the exact MAX_CUMULATIVE_TOKENS boundary, never
  // later.
  RESERVATION_TOKEN_ESTIMATE: 3000,
});

export const CHAT_SESSION_CLOSE_REASONS = Object.freeze({
  MESSAGE_LIMIT: "message_limit",
  TOKEN_LIMIT: "token_limit",
  INACTIVITY_TIMEOUT: "inactivity_timeout",
  FIRST_CALL_REFUNDED: "first_call_refunded",
  // A first-message Anthropic failure whose refund_ai_credit call ALSO
  // failed — the session is still permanently closed (never reused), but
  // this reason durably distinguishes "credit was restored" from "credit
  // may still be missing from the user's balance and needs admin/manual
  // reconciliation" (see lib/chatTelemetry usage in pages/api/chat.js and
  // the ai_chat_usage row logged alongside it).
  FIRST_CALL_REFUND_FAILED: "first_call_refund_failed",
});

export const CHAT_USAGE_STATUS = Object.freeze({
  SUCCEEDED: "succeeded",
  UPSTREAM_FAILED: "upstream_failed",
  REFUNDED: "refunded",
  REFUND_FAILED: "refund_failed",
  RECONCILE_FAILED: "reconcile_failed",
});
