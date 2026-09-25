import { test } from "node:test";
import assert from "node:assert/strict";

import { CHAT_MODEL, CHAT_SESSION_LIMITS, CHAT_SESSION_CLOSE_REASONS, CHAT_USAGE_STATUS } from "./chatConfig.js";

test("CHAT_MODEL matches the V1 spec's 'preserve the currently established model' requirement", () => {
  assert.equal(CHAT_MODEL, "claude-sonnet-4-5");
});

test("CHAT_SESSION_LIMITS matches the V1 product rule's exact numbers", () => {
  assert.equal(CHAT_SESSION_LIMITS.MAX_USER_MESSAGES, 10);
  assert.equal(CHAT_SESSION_LIMITS.INACTIVITY_TIMEOUT_MS, 30 * 60 * 1000);
  assert.equal(CHAT_SESSION_LIMITS.MAX_CUMULATIVE_TOKENS, 20000);
  assert.equal(CHAT_SESSION_LIMITS.MAX_OUTPUT_TOKENS_PER_MESSAGE, 1200);
  assert.ok(CHAT_SESSION_LIMITS.MAX_USER_MESSAGE_LENGTH > 0);
  assert.ok(CHAT_SESSION_LIMITS.RESERVATION_TOKEN_ESTIMATE > CHAT_SESSION_LIMITS.MAX_OUTPUT_TOKENS_PER_MESSAGE);
});

test("CHAT_SESSION_LIMITS is frozen (a scattered magic-number rewrite elsewhere can never silently diverge)", () => {
  assert.throws(() => {
    CHAT_SESSION_LIMITS.MAX_USER_MESSAGES = 999;
  }, TypeError);
});

test("CHAT_SESSION_CLOSE_REASONS enumerates exactly the reasons the migration's check constraint accepts", () => {
  assert.deepEqual(Object.values(CHAT_SESSION_CLOSE_REASONS).sort(), [
    "first_call_refund_failed",
    "first_call_refunded",
    "inactivity_timeout",
    "message_limit",
    "token_limit",
  ]);
});

test("CHAT_USAGE_STATUS enumerates exactly the statuses the ai_chat_usage check constraint accepts", () => {
  assert.deepEqual(Object.values(CHAT_USAGE_STATUS).sort(), [
    "reconcile_failed",
    "refund_failed",
    "refunded",
    "succeeded",
    "upstream_failed",
  ]);
});
