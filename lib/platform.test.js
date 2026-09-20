import { test } from "node:test";
import assert from "node:assert/strict";

import { isNativePlatform, getWebOrigin } from "./platform.js";

test("isNativePlatform: false in this Node test environment (no window)", () => {
  assert.equal(isNativePlatform(), false);
});

test("isNativePlatform: false when window exists but Capacitor was never injected", () => {
  globalThis.window = {};
  try {
    assert.equal(isNativePlatform(), false);
  } finally {
    delete globalThis.window;
  }
});

test("isNativePlatform: false when window.Capacitor exists but isNativePlatform is not a function", () => {
  globalThis.window = { Capacitor: {} };
  try {
    assert.equal(isNativePlatform(), false);
  } finally {
    delete globalThis.window;
  }
});

test("isNativePlatform: reflects window.Capacitor.isNativePlatform() once Capacitor bootstraps", () => {
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  try {
    assert.equal(isNativePlatform(), true);
  } finally {
    delete globalThis.window;
  }
});

test("getWebOrigin: null when NEXT_PUBLIC_WEB_ORIGIN is unset", () => {
  const prev = process.env.NEXT_PUBLIC_WEB_ORIGIN;
  delete process.env.NEXT_PUBLIC_WEB_ORIGIN;
  try {
    assert.equal(getWebOrigin(), null);
  } finally {
    if (prev !== undefined) process.env.NEXT_PUBLIC_WEB_ORIGIN = prev;
  }
});

test("getWebOrigin: returns the configured origin as-is", () => {
  const prev = process.env.NEXT_PUBLIC_WEB_ORIGIN;
  process.env.NEXT_PUBLIC_WEB_ORIGIN = "https://example.com";
  try {
    assert.equal(getWebOrigin(), "https://example.com");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_WEB_ORIGIN;
    else process.env.NEXT_PUBLIC_WEB_ORIGIN = prev;
  }
});
