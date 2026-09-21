import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveNativeDeepLink,
  SUPPORTED_NATIVE_ROUTES,
  claimNativeUrl,
  fingerprintUrl,
  handleIncomingUrl,
  initNativeDeepLinks,
} from "./nativeDeepLink.js";

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

// --- duplicate-delivery guard (reload-loop regression) ---------------------

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _dump: () => [...map.values()].join("\n"),
  };
}

const RECOVERY_A = `${WEB_ORIGIN}/reset-password#access_token=tokA&refresh_token=refA&type=recovery`;
const RECOVERY_B = `${WEB_ORIGIN}/reset-password#access_token=tokB&refresh_token=refB&type=recovery`;

test("first delivery of a supported URL is handled and navigates once", () => {
  const storage = fakeStorage();
  const navigated = [];
  const result = handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, {
    storage,
    memory: new Set(),
    navigate: (p) => navigated.push(p),
  });
  assert.equal(result, "navigated");
  assert.deepEqual(navigated, ["/reset-password#access_token=tokA&refresh_token=refA&type=recovery"]);
});

test("second delivery of the exact same URL in the same session is ignored", () => {
  const storage = fakeStorage();
  const memory = new Set();
  const navigated = [];
  const deps = { storage, memory, navigate: (p) => navigated.push(p) };
  assert.equal(handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, deps), "navigated");
  assert.equal(handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, deps), "duplicate");
  assert.equal(navigated.length, 1);
});

test("a different reset URL (new token) is still handled after an earlier one", () => {
  const storage = fakeStorage();
  const memory = new Set();
  const navigated = [];
  const deps = { storage, memory, navigate: (p) => navigated.push(p) };
  handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, deps);
  assert.equal(handleIncomingUrl(RECOVERY_B, WEB_ORIGIN, deps), "navigated");
  assert.equal(navigated.length, 2);
  assert.match(navigated[1], /tokB/);
});

test("a stale earlier URL is not re-handled after a newer URL was handled", () => {
  const storage = fakeStorage();
  const navigated = [];
  const deps = { storage, memory: new Set(), navigate: (p) => navigated.push(p) };
  handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, deps);
  handleIncomingUrl(RECOVERY_B, WEB_ORIGIN, deps);
  // getLaunchUrl() keeps returning A after B's reload.
  assert.equal(handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, deps), "duplicate");
  assert.equal(navigated.length, 2);
});

test("unsupported host/path/scheme are rejected and never recorded", () => {
  const storage = fakeStorage();
  const navigated = [];
  const deps = { storage, memory: new Set(), navigate: (p) => navigated.push(p) };
  assert.equal(handleIncomingUrl("https://evil.example.com/reset-password", WEB_ORIGIN, deps), "rejected");
  assert.equal(handleIncomingUrl(`${WEB_ORIGIN}/some-other-page`, WEB_ORIGIN, deps), "rejected");
  assert.equal(handleIncomingUrl("capacitor://localhost/reset-password", WEB_ORIGIN, deps), "rejected");
  assert.equal(navigated.length, 0);
  assert.equal(storage.getItem("almeo.nativeDeepLink.handled"), null);
});

test("cold start delivers the same URL twice in one document (appUrlOpen + getLaunchUrl): one navigation", () => {
  const storage = fakeStorage();
  const memory = new Set();
  const navigated = [];
  const deps = { storage, memory, navigate: (p) => navigated.push(p) };
  handleIncomingUrl(`${WEB_ORIGIN}/reset-password`, WEB_ORIGIN, deps); // retained appUrlOpen
  handleIncomingUrl(`${WEB_ORIGIN}/reset-password`, WEB_ORIGIN, deps); // getLaunchUrl()
  assert.deepEqual(navigated, ["/reset-password"]);
});

test("reload-loop regression: getLaunchUrl() keeps returning the launch URL after each hard reload, yet only ONE navigation happens", () => {
  const storage = fakeStorage(); // sessionStorage survives the WebView reload
  const launchUrl = `${WEB_ORIGIN}/reset-password`; // Bridge.intentUri never clears
  let navigations = 0;
  // Each iteration = one page load: module state (memory Set) is fresh,
  // storage is not, and the app re-delivers the launch URL.
  for (let load = 0; load < 10; load++) {
    const result = handleIncomingUrl(launchUrl, WEB_ORIGIN, {
      storage,
      memory: new Set(),
      navigate: () => navigations++,
    });
    if (load === 0) assert.equal(result, "navigated");
    else assert.equal(result, "duplicate");
  }
  assert.equal(navigations, 1);
});

test("a new session (empty storage) handles the same URL again", () => {
  const navigated = [];
  const run = (storage) =>
    handleIncomingUrl(RECOVERY_A, WEB_ORIGIN, { storage, memory: new Set(), navigate: (p) => navigated.push(p) });
  assert.equal(run(fakeStorage()), "navigated");
  assert.equal(run(fakeStorage()), "navigated");
  assert.equal(navigated.length, 2);
});

test("the stored marker never contains the URL, path, or any token", () => {
  const storage = fakeStorage();
  claimNativeUrl(RECOVERY_A, storage, new Set());
  const stored = storage._dump();
  assert.ok(stored.length > 0);
  for (const secret of ["tokA", "refA", "access_token", "refresh_token", "reset-password", WEB_ORIGIN]) {
    assert.equal(stored.includes(secret), false, `stored marker leaks ${secret}`);
  }
});

test("markers are exact-match: URLs differing only in hash get different fingerprints", () => {
  assert.notEqual(fingerprintUrl(RECOVERY_A), fingerprintUrl(RECOVERY_B));
  assert.equal(fingerprintUrl(RECOVERY_A), fingerprintUrl(RECOVERY_A));
});

test("marker set is capped so sessionStorage cannot grow unbounded", () => {
  const storage = fakeStorage();
  for (let i = 0; i < 50; i++) claimNativeUrl(`${WEB_ORIGIN}/reset-password?n=${i}`, storage, new Set());
  const stored = JSON.parse(storage.getItem("almeo.nativeDeepLink.handled"));
  assert.equal(stored.length, 20);
});

test("still de-duplicates within one document if storage throws", () => {
  const brokenStorage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  const memory = new Set();
  assert.equal(claimNativeUrl(RECOVERY_A, brokenStorage, memory), true);
  assert.equal(claimNativeUrl(RECOVERY_A, brokenStorage, memory), false);
});

test("web behavior unchanged: initNativeDeepLinks is a no-op when not on a native platform", () => {
  // No window (plain Node) and a window without an active Capacitor native
  // shell must both be inert: no throw, nothing registered, no navigation.
  assert.equal(initNativeDeepLinks(WEB_ORIGIN), undefined);
  const prevWindow = globalThis.window;
  try {
    globalThis.window = { Capacitor: { isNativePlatform: () => false }, location: { href: "/" } };
    assert.equal(initNativeDeepLinks(WEB_ORIGIN), undefined);
    assert.equal(globalThis.window.location.href, "/");
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
