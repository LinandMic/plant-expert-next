import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeElementLabel,
  describeDomNode,
  describeParentChain,
  summarizeElementsAtPoint,
  collectHomeRuntimeDiagnostics,
} from "./homeDomDiagnostics.js";

// Minimal fake DOM element — only the surface these helpers actually touch.
function fakeEl({
  tagName = "DIV",
  className = "",
  textContent = "",
  rect = { x: 0, y: 0, width: 0, height: 0 },
  childElementCount = 0,
  offsetWidth = 0,
  offsetHeight = 0,
  clientWidth = 0,
  clientHeight = 0,
  isConnected = true,
  clientRectsCount = 1,
  parentElement = null,
  getBoundingClientRectThrows = false,
} = {}) {
  return {
    tagName,
    className,
    textContent,
    childElementCount,
    offsetWidth,
    offsetHeight,
    clientWidth,
    clientHeight,
    isConnected,
    parentElement,
    getBoundingClientRect: () => {
      if (getBoundingClientRectThrows) throw new Error("boom");
      return rect;
    },
    getClientRects: () => ({ length: clientRectsCount }),
  };
}

test("describeElementLabel: null -> placeholder, never throws", () => {
  assert.equal(describeElementLabel(null), "(null)");
  assert.equal(describeElementLabel(undefined), "(null)");
});

test("describeElementLabel: tag + first class only, never id/attrs/content", () => {
  assert.equal(describeElementLabel(fakeEl({ tagName: "SECTION", className: "ad-section extra" })), "section.ad-section");
  assert.equal(describeElementLabel(fakeEl({ tagName: "DIV", className: "" })), "div");
});

test("describeDomNode: absent node -> {exists:false}, never throws", () => {
  assert.deepEqual(describeDomNode(null, () => ({})), { exists: false });
  assert.deepEqual(describeDomNode(undefined, () => ({})), { exists: false });
});

test("describeDomNode: a getComputedStyle that throws degrades to an empty computed object, not a crash", () => {
  const el = fakeEl({ rect: { x: 1, y: 2, width: 100, height: 50 } });
  const throwingGetComputedStyle = () => {
    throw new Error("getComputedStyle unavailable");
  };
  const result = describeDomNode(el, throwingGetComputedStyle);
  assert.equal(result.exists, true);
  assert.deepEqual(result.computed, {});
});

test("describeDomNode: a getBoundingClientRect that throws still returns a safe zeroed rect", () => {
  const el = fakeEl({ getBoundingClientRectThrows: true });
  const result = describeDomNode(el, () => ({}));
  assert.equal(result.exists, true);
  assert.deepEqual(result.rect, { x: 0, y: 0, width: 0, height: 0 });
});

test("describeDomNode: reports geometry/computed style, and only the LENGTH of text content, never the text", () => {
  const el = fakeEl({
    tagName: "SECTION",
    textContent: "Bonjour Camille — a real user's name that must never leak",
    rect: { x: 10, y: 20, width: 300, height: 0 },
    childElementCount: 4,
    offsetWidth: 300,
    offsetHeight: 0,
  });
  const fakeComputedStyle = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    position: "static",
    zIndex: "auto",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    height: "0px",
    minHeight: "0px",
    maxHeight: "none",
    width: "300px",
    color: "rgb(0,0,0)",
    backgroundColor: "rgba(0,0,0,0)",
    transform: "none",
    clip: "auto",
    clipPath: "none",
  };
  const result = describeDomNode(el, () => fakeComputedStyle);

  assert.equal(result.exists, true);
  assert.equal(result.tagName, "SECTION");
  assert.equal(result.childElementCount, 4);
  assert.equal(result.textLength, "Bonjour Camille — a real user's name that must never leak".length);
  assert.equal(result.rect.height, 0);
  assert.equal(result.computed.display, "block");
  assert.equal(result.computed.height, "0px");

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("Camille"), false);
  assert.equal(serialized.includes("Bonjour"), false);
});

test("describeParentChain: absent parent -> empty array, never throws", () => {
  assert.deepEqual(describeParentChain(fakeEl({ parentElement: null }), 6, () => ({})), []);
  assert.deepEqual(describeParentChain(null, 6, () => ({})), []);
});

test("describeParentChain: walks up to maxDepth parents, one compact line each", () => {
  const grandparent = fakeEl({ tagName: "DIV", className: "pe-shell", rect: { width: 1440, height: 900 }, parentElement: null });
  const parent = fakeEl({ tagName: "DIV", className: "pe-shell-content", rect: { width: 1200, height: 800 }, parentElement: grandparent });
  const el = fakeEl({ parentElement: parent });

  const chain = describeParentChain(el, 6, () => ({ display: "block", visibility: "visible", opacity: "1", position: "static", overflow: "visible" }));

  assert.equal(chain.length, 2);
  assert.equal(chain[0].label, "div.pe-shell-content");
  assert.equal(chain[0].rectWidth, 1200);
  assert.equal(chain[1].label, "div.pe-shell");
});

test("describeParentChain: respects maxDepth even with a longer chain", () => {
  let node = null;
  for (let i = 0; i < 10; i++) {
    node = fakeEl({ tagName: "DIV", className: `level-${i}`, parentElement: node });
  }
  const chain = describeParentChain(node, 3, () => ({}));
  assert.equal(chain.length, 3);
});

test("summarizeElementsAtPoint: non-array input -> [], never throws", () => {
  assert.deepEqual(summarizeElementsAtPoint(null), []);
  assert.deepEqual(summarizeElementsAtPoint(undefined), []);
});

test("summarizeElementsAtPoint: labels only, capped at the limit", () => {
  const elements = [
    fakeEl({ tagName: "DIV", className: "overlay-mask" }),
    fakeEl({ tagName: "SECTION", className: "ad-hero" }),
    fakeEl({ tagName: "BODY", className: "" }),
  ];
  assert.deepEqual(summarizeElementsAtPoint(elements, 2), ["div.overlay-mask", "section.ad-hero"]);
});

test("collectHomeRuntimeDiagnostics: no documentRef -> safe empty result, never throws", () => {
  assert.deepEqual(collectHomeRuntimeDiagnostics(["hero"], {}), { nodes: {}, parentChain: [], elementsAtPoint: [] });
});

test("collectHomeRuntimeDiagnostics: queries every requested node name and reports missing ones as exists:false", () => {
  const hero = fakeEl({ tagName: "SECTION", className: "ad-hero", rect: { width: 1000, height: 80 } });
  const byName = { hero };
  const documentRef = {
    querySelector: (selector) => {
      const match = selector.match(/data-home-node="([^"]+)"/);
      const name = match ? match[1] : null;
      return byName[name] || null;
    },
  };

  const result = collectHomeRuntimeDiagnostics(["hero", "weather", "connected-root"], { documentRef, getComputedStyleFn: () => ({}) });

  assert.equal(result.nodes.hero.exists, true);
  assert.equal(result.nodes.weather.exists, false);
  assert.equal(result.nodes["connected-root"].exists, false);
});

test("collectHomeRuntimeDiagnostics: uses connected-root's center to summarize elementsFromPoint, capped at 5", () => {
  const root = fakeEl({ tagName: "DIV", className: "ad-page", rect: { x: 200, y: 40, width: 800, height: 400 } });
  const overlay = fakeEl({ tagName: "DIV", className: "some-overlay" });
  const documentRef = {
    querySelector: (selector) => (selector.includes('"connected-root"') ? root : null),
    elementsFromPoint: (x, y) => {
      assert.equal(x, 200 + 400); // rect.x + width/2
      assert.equal(y, 40 + 100); // min(height/2, 100)
      return [overlay, root];
    },
  };

  const result = collectHomeRuntimeDiagnostics(["connected-root"], { documentRef, getComputedStyleFn: () => ({}) });
  assert.deepEqual(result.elementsAtPoint, ["div.some-overlay", "div.ad-page"]);
});

test("collectHomeRuntimeDiagnostics: a zero-size root never calls elementsFromPoint (nothing to probe)", () => {
  const root = fakeEl({ tagName: "DIV", className: "ad-page", rect: { x: 0, y: 0, width: 0, height: 0 } });
  let called = false;
  const documentRef = {
    querySelector: (selector) => (selector.includes('"connected-root"') ? root : null),
    elementsFromPoint: () => {
      called = true;
      return [];
    },
  };
  const result = collectHomeRuntimeDiagnostics(["connected-root"], { documentRef, getComputedStyleFn: () => ({}) });
  assert.equal(called, false);
  assert.deepEqual(result.elementsAtPoint, []);
});
