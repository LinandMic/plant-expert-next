import { test } from "node:test";
import assert from "node:assert/strict";

import { resolvePasswordResetRedirect } from "./authRedirect.js";

test("web: builds a same-origin redirect from windowOrigin", () => {
  const result = resolvePasswordResetRedirect({
    isNative: false,
    webOrigin: null,
    windowOrigin: "https://plant-expert-next-rxq9.vercel.app",
  });
  assert.deepEqual(result, { redirectTo: "https://plant-expert-next-rxq9.vercel.app/reset-password" });
});

test("web: no windowOrigin (SSR) yields undefined redirectTo, no error", () => {
  const result = resolvePasswordResetRedirect({ isNative: false, webOrigin: null, windowOrigin: undefined });
  assert.deepEqual(result, { redirectTo: undefined });
});

test("native: builds the redirect from NEXT_PUBLIC_WEB_ORIGIN, ignoring windowOrigin entirely", () => {
  const result = resolvePasswordResetRedirect({
    isNative: true,
    webOrigin: "https://plant-expert-next-rxq9.vercel.app",
    windowOrigin: "capacitor://localhost",
  });
  assert.deepEqual(result, { redirectTo: "https://plant-expert-next-rxq9.vercel.app/reset-password" });
});

test("native: normalizes a webOrigin with a trailing slash", () => {
  const result = resolvePasswordResetRedirect({
    isNative: true,
    webOrigin: "https://plant-expert-next-rxq9.vercel.app/",
    windowOrigin: undefined,
  });
  assert.deepEqual(result, { redirectTo: "https://plant-expert-next-rxq9.vercel.app/reset-password" });
});

test("native: missing webOrigin returns a developer-safe error, never a broken URL", () => {
  const result = resolvePasswordResetRedirect({ isNative: true, webOrigin: null, windowOrigin: undefined });
  assert.equal(result.redirectTo, undefined);
  assert.match(result.error, /NEXT_PUBLIC_WEB_ORIGIN/);
});

test("native: unparseable webOrigin returns a developer-safe error", () => {
  const result = resolvePasswordResetRedirect({ isNative: true, webOrigin: "not a url", windowOrigin: undefined });
  assert.equal(result.redirectTo, undefined);
  assert.match(result.error, /NEXT_PUBLIC_WEB_ORIGIN/);
});

test("native: non-https webOrigin (e.g. a stray capacitor:// value) is rejected", () => {
  const result = resolvePasswordResetRedirect({
    isNative: true,
    webOrigin: "capacitor://localhost",
    windowOrigin: undefined,
  });
  assert.equal(result.redirectTo, undefined);
  assert.match(result.error, /NEXT_PUBLIC_WEB_ORIGIN/);
});
