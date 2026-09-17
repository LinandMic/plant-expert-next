import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyOrigin, isSameOriginReferer, ALLOWED_NATIVE_ORIGINS } from "./apiOrigin.js";

test("classifyOrigin: same-origin web request (Origin host matches Host header)", () => {
  assert.equal(classifyOrigin("https://plant-expert-next-rxq9.vercel.app", "plant-expert-next-rxq9.vercel.app"), "same-origin");
});

test("classifyOrigin: allowed Capacitor iOS origin", () => {
  assert.equal(classifyOrigin("capacitor://localhost", "plant-expert-next-rxq9.vercel.app"), "native");
});

test("classifyOrigin: allowed Capacitor Android origin", () => {
  assert.equal(classifyOrigin("https://localhost", "plant-expert-next-rxq9.vercel.app"), "native");
});

test("classifyOrigin: unknown external origin is rejected", () => {
  assert.equal(classifyOrigin("https://evil.example.com", "plant-expert-next-rxq9.vercel.app"), null);
});

test("classifyOrigin: mismatched web origin (different host) is rejected", () => {
  assert.equal(classifyOrigin("https://some-other-app.vercel.app", "plant-expert-next-rxq9.vercel.app"), null);
});

test("classifyOrigin: no Origin header -> null (caller falls back to Referer)", () => {
  assert.equal(classifyOrigin(undefined, "plant-expert-next-rxq9.vercel.app"), null);
  assert.equal(classifyOrigin("", "plant-expert-next-rxq9.vercel.app"), null);
});

test("classifyOrigin: no Host header and no native match -> null", () => {
  assert.equal(classifyOrigin("https://plant-expert-next-rxq9.vercel.app", undefined), null);
});

test("classifyOrigin: malformed Origin header never throws, is rejected", () => {
  assert.equal(classifyOrigin("not-a-url", "plant-expert-next-rxq9.vercel.app"), null);
});

test("classifyOrigin: native origins are matched exactly, not just by host", () => {
  // A spoofed page can't literally send these as its Origin (only the
  // WebView itself sets Origin), but the classifier must not be fooled by
  // host-only matching either — it's a raw allowlist match, not host equality.
  assert.equal(classifyOrigin("http://localhost", "plant-expert-next-rxq9.vercel.app"), null);
  assert.equal(classifyOrigin("https://localhost:3000", "plant-expert-next-rxq9.vercel.app"), null);
});

test("ALLOWED_NATIVE_ORIGINS: exactly the documented iOS + Android defaults", () => {
  assert.deepEqual([...ALLOWED_NATIVE_ORIGINS].sort(), ["capacitor://localhost", "https://localhost"]);
});

test("isSameOriginReferer: true when Referer host matches Host header", () => {
  assert.equal(isSameOriginReferer("https://plant-expert-next-rxq9.vercel.app/identifier", "plant-expert-next-rxq9.vercel.app"), true);
});

test("isSameOriginReferer: false for a different host", () => {
  assert.equal(isSameOriginReferer("https://evil.example.com/", "plant-expert-next-rxq9.vercel.app"), false);
});

test("isSameOriginReferer: false when either input is missing", () => {
  assert.equal(isSameOriginReferer(undefined, "plant-expert-next-rxq9.vercel.app"), false);
  assert.equal(isSameOriginReferer("https://plant-expert-next-rxq9.vercel.app/", undefined), false);
});

test("isSameOriginReferer: malformed Referer never throws, is rejected", () => {
  assert.equal(isSameOriginReferer("not-a-url", "plant-expert-next-rxq9.vercel.app"), false);
});
