import { test } from "node:test";
import assert from "node:assert/strict";

import { ANTHROPIC_ANALYSIS_TIMEOUT_MS, ANTHROPIC_REQUEST_TIMEOUT_MS, createAnthropicTimeout } from "./anthropicRequestConfig.js";

function makeAbortError() {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

test("ANTHROPIC_REQUEST_TIMEOUT_MS is a conservative, positive, production-safe value", () => {
  assert.equal(typeof ANTHROPIC_REQUEST_TIMEOUT_MS, "number");
  assert.ok(ANTHROPIC_REQUEST_TIMEOUT_MS > 0);
  // Sanity bounds: long enough for a real Claude response, short enough to
  // leave headroom inside a typical serverless platform timeout.
  assert.ok(ANTHROPIC_REQUEST_TIMEOUT_MS >= 10000);
  assert.ok(ANTHROPIC_REQUEST_TIMEOUT_MS <= 60000);
});

test("chat keeps the 25s default; image analysis has its own, longer budget", () => {
  assert.equal(ANTHROPIC_REQUEST_TIMEOUT_MS, 25000);
  assert.equal(ANTHROPIC_ANALYSIS_TIMEOUT_MS, 100000);
  assert.ok(ANTHROPIC_ANALYSIS_TIMEOUT_MS > ANTHROPIC_REQUEST_TIMEOUT_MS);
});

test("createAnthropicTimeout: timeoutMs overrides the default delay", () => {
  const setCalls = [];
  createAnthropicTimeout({
    timeoutMs: ANTHROPIC_ANALYSIS_TIMEOUT_MS,
    setTimeoutImpl: (fn, ms) => {
      setCalls.push(ms);
      return {};
    },
    clearTimeoutImpl: () => {},
  });
  assert.deepEqual(setCalls, [ANTHROPIC_ANALYSIS_TIMEOUT_MS]);
});

test("createAnthropicTimeout: the signal is not aborted immediately, only once the timer actually fires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { signal, clear } = createAnthropicTimeout();

  assert.equal(signal.aborted, false);
  t.mock.timers.tick(ANTHROPIC_REQUEST_TIMEOUT_MS - 1);
  assert.equal(signal.aborted, false, "must not fire a moment early");

  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true, "must fire exactly at ANTHROPIC_REQUEST_TIMEOUT_MS");

  clear(); // clearing an already-fired timer must be a harmless no-op
});

test("createAnthropicTimeout: clear() cancels the real timer so the signal never aborts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { signal, clear } = createAnthropicTimeout();

  clear();
  t.mock.timers.tick(ANTHROPIC_REQUEST_TIMEOUT_MS * 10);
  assert.equal(signal.aborted, false, "a cleared timer must never abort the signal, no matter how long the clock runs");
});

test("createAnthropicTimeout: setTimeoutImpl/clearTimeoutImpl are the only timer functions used (fully injectable, no hidden global timer)", () => {
  const setCalls = [];
  const clearCalls = [];
  const fakeTimer = { id: "fake-timer-handle" };
  const { clear } = createAnthropicTimeout({
    setTimeoutImpl: (fn, ms) => {
      setCalls.push({ fn, ms });
      return fakeTimer;
    },
    clearTimeoutImpl: (timer) => {
      clearCalls.push(timer);
    },
  });

  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].ms, ANTHROPIC_REQUEST_TIMEOUT_MS);
  clear();
  assert.equal(clearCalls.length, 1);
  assert.equal(clearCalls[0], fakeTimer, "clear() must pass through the exact handle setTimeoutImpl returned");
});

test("createAnthropicTimeout: one signal covers BOTH a pending fetch call and a separate pending body read started after fetch resolved", (t) => {
  // Mirrors the real shape in pages/api/proxy.js and pages/api/chat.js:
  // the signal is obtained once, used for the fetch call, and the SAME
  // signal is still being listened to later by a second, independent
  // consumer (the response body reader) that started only after the
  // fetch already resolved. Aborting once must reject both -- this is
  // the property the proxy.js/chat.js fix depends on, verified here at
  // the primitive level without any HTTP handler involved.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { signal } = createAnthropicTimeout();

  const fetchRejected = [];
  signal.addEventListener("abort", () => fetchRejected.push("fetch"), { once: true });

  // Headers "arrive" first: fetch's own listener already fired? No --
  // nothing has aborted yet at this point.
  assert.equal(signal.aborted, false);

  // A second consumer (the body reader) starts listening only now,
  // after headers already arrived -- exactly like response.json() being
  // called after fetchImpl() already resolved.
  const bodyRejected = [];
  signal.addEventListener("abort", () => bodyRejected.push(makeAbortError()), { once: true });

  t.mock.timers.tick(ANTHROPIC_REQUEST_TIMEOUT_MS);

  assert.equal(signal.aborted, true);
  assert.deepEqual(fetchRejected, ["fetch"]);
  assert.equal(bodyRejected.length, 1);
  assert.equal(bodyRejected[0].name, "AbortError", "the body-read consumer sees the same AbortError shape");
});
