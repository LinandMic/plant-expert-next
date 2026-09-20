import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveNativeDeepLink, SUPPORTED_NATIVE_ROUTES } from "./nativeDeepLink.js";

const WEB_ORIGIN = "https://plant-expert-next-rxq9.vercel.app";

test("accepts a supported route on the configured origin, preserving the recovery hash", () => {
  const result = resolveNativeDeepLink(
    `${WEB_ORIGIN}/reset-password#access_token=abc&refresh_token=def&type=recovery`,
    WEB_ORIGIN,
  );
  assert.deepEqual(result, { localPath: "/reset-password#access_token=abc&refresh_token=def&type=recovery" });
});

test("accepts a supported route with query params too", () => {
  const result = resolveNativeDeepLink(`${WEB_ORIGIN}/reset-password?foo=bar`, WEB_ORIGIN);
  assert.deepEqual(result, { localPath: "/reset-password?foo=bar" });
});

test("rejects a different host, even if https", () => {
  assert.equal(resolveNativeDeepLink("https://evil.example.com/reset-password", WEB_ORIGIN), null);
});

test("rejects an unsupported path on the trusted origin", () => {
  assert.equal(resolveNativeDeepLink(`${WEB_ORIGIN}/some-other-page`, WEB_ORIGIN), null);
});

test("rejects a non-https scheme (custom scheme spoofing an https path)", () => {
  assert.equal(resolveNativeDeepLink("capacitor://localhost/reset-password", WEB_ORIGIN), null);
  assert.equal(resolveNativeDeepLink("almeo://reset-password", WEB_ORIGIN), null);
});

test("rejects when webOrigin is missing or unparseable", () => {
  assert.equal(resolveNativeDeepLink(`${WEB_ORIGIN}/reset-password`, null), null);
  assert.equal(resolveNativeDeepLink(`${WEB_ORIGIN}/reset-password`, "not a url"), null);
});

test("rejects an unparseable incoming URL", () => {
  assert.equal(resolveNativeDeepLink("not a url", WEB_ORIGIN), null);
});

test("SUPPORTED_NATIVE_ROUTES currently exposes only /reset-password", () => {
  assert.deepEqual([...SUPPORTED_NATIVE_ROUTES], ["/reset-password"]);
});
