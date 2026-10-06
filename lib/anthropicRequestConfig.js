// Shared timeout for the outbound Anthropic call in BOTH
// pages/api/proxy.js and pages/api/chat.js. Kept as its own tiny module
// (not lib/chatConfig.js, which is chat-session-specific) so proxy.js
// never has to depend on chat session config, and chat.js never has to
// depend on anything proxy-specific — both import only this.
//
// 25s: conservative enough to comfortably cover a normal Claude response
// (a full plant-identification JSON payload, or a multi-paragraph chat
// reply) while still leaving headroom inside Vercel's platform-level
// serverless function timeout, so a hung upstream call never silently
// occupies the function for its full duration — and, for an analysis or
// first-chat-message request, never leaves a charged credit in limbo
// longer than necessary before the refund path can run.
export const ANTHROPIC_REQUEST_TIMEOUT_MS = 25000;

// createAnthropicTimeout({ setTimeoutImpl, clearTimeoutImpl }) -> { signal, clear }
//
// The timeout must cover the FULL round trip to Anthropic: the initial
// connection AND the subsequent read of the response body. A slow or
// stuck upstream can send headers promptly and then stall mid-body just
// as easily as it can fail to connect at all — both must time out the
// same way, or a stalled body read runs with no timeout protection at
// all once headers have arrived.
//
// Callers get `signal` once, before calling fetchImpl, and pass that
// SAME signal to that one fetch call. Aborting the controller also
// aborts any pending read on that fetch's response body (standard Fetch
// API/undici behavior: the underlying connection is torn down, so a
// pending response.json()/.text() rejects with the same AbortError a
// stalled connection attempt would) — no second signal or second timer
// is needed to cover the body read.
//
// Callers MUST call `clear()` exactly once, in a `finally` wrapped
// around BOTH the fetch call and the body read, regardless of outcome.
// `setTimeoutImpl`/`clearTimeoutImpl` are injectable so tests can drive
// the timeout deterministically (e.g. via node:test's mock timers)
// instead of waiting on a real 25s clock.
export function createAnthropicTimeout({
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeoutImpl(() => controller.abort(), ANTHROPIC_REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeoutImpl(timer),
  };
}
