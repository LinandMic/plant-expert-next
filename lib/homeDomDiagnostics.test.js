import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeElementLabel,
  describeDomNode,
  describeParentChain,
  summarizeElementsAtPoint,
  collectMatchedDisplayRules,
  collectHomeRuntimeDiagnostics,
} from "./homeDomDiagnostics.js";

// Minimal fake DOM element — only the surface these helpers actually touch.
function fakeEl({
  tagName = "DIV",
  className = "",
  id = "",
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
  hidden = false,
  attributes = {},
  matchesSelectors = null,
  offsetParent = {},
  inert = undefined,
} = {}) {
  return {
    tagName,
    className,
    id,
    textContent,
    childElementCount,
    offsetWidth,
    offsetHeight,
    clientWidth,
    clientHeight,
    isConnected,
    parentElement,
    hidden,
    offsetParent,
    ...(inert !== undefined ? { inert } : {}),
    getBoundingClientRect: () => {
      if (getBoundingClientRectThrows) throw new Error("boom");
      return rect;
    },
    getClientRects: () => ({ length: clientRectsCount }),
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attributes, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null),
    getAttributeNames: () => Object.keys(attributes),
    matches: (selector) => (matchesSelectors ? matchesSelectors.includes(selector) : false),
  };
}

// Minimal fake CSSStyleSheet/CSSRule surface for collectMatchedDisplayRules.
function fakeRule({ selectorText, display, priority = "", type = 1 }) {
  return {
    type,
    selectorText,
    style: {
      getPropertyValue: (prop) => (prop === "display" ? display || "" : ""),
      getPropertyPriority: (prop) => (prop === "display" ? priority : ""),
    },
  };
}

function fakeMediaRule(conditionText, cssRules) {
  return { type: 4, conditionText, cssRules };
}

function fakeSheet({ href = null, cssRules = [], throwsOnAccess = false } = {}) {
  if (throwsOnAccess) {
    return {
      href,
      get cssRules() {
        throw new Error("Cannot access rules (cross-origin)");
      },
    };
  }
  return { href, cssRules };
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

// --- Runtime attributes (hidden / aria-hidden / inert / inline style) ---

test("describeDomNode: reports hidden/aria-hidden/inert/inline-style/class/id, never other attribute values", () => {
  const el = fakeEl({
    tagName: "SECTION",
    className: "ad-hero",
    id: "",
    attributes: { hidden: "", "aria-hidden": "true", style: "color:red", "data-home-node": "hero" },
    hidden: true,
  });
  const result = describeDomNode(el, () => ({}));
  assert.equal(result.attributes.hiddenProperty, true);
  assert.equal(result.attributes.hasHiddenAttribute, true);
  assert.equal(result.attributes.hiddenAttributeValue, "");
  assert.equal(result.attributes.ariaHidden, "true");
  assert.equal(result.attributes.inlineStyle, "color:red");
  assert.equal(result.attributes.className, "ad-hero");
  assert.deepEqual(result.attributes.attributeNames.sort(), ["aria-hidden", "data-home-node", "hidden", "style"]);
});

test("describeDomNode: inert absent from the element -> null, never throws", () => {
  const el = fakeEl({ tagName: "SECTION" });
  const result = describeDomNode(el, () => ({}));
  assert.equal(result.attributes.inertProperty, null);
});

test("describeDomNode: offsetParentPresent reflects offsetParent !== null", () => {
  const visible = fakeEl({ offsetParent: {} });
  const detachedOrHidden = fakeEl({ offsetParent: null });
  assert.equal(describeDomNode(visible, () => ({})).offsetParentPresent, true);
  assert.equal(describeDomNode(detachedOrHidden, () => ({})).offsetParentPresent, false);
});

// --- Matched author CSS display rules ---

test("collectMatchedDisplayRules: no element or no stylesheets -> empty, never throws", () => {
  assert.deepEqual(collectMatchedDisplayRules(null, [fakeSheet()]), { matched: [], accessErrors: [] });
  assert.deepEqual(collectMatchedDisplayRules(fakeEl(), null), { matched: [], accessErrors: [] });
});

test("collectMatchedDisplayRules: only rules that both match the element AND declare display are kept", () => {
  const el = fakeEl({ matchesSelectors: [".ad-hero", "*"] });
  const sheet = fakeSheet({
    href: "https://example.com/app.css",
    cssRules: [
      fakeRule({ selectorText: "*", display: "" }), // declares no display -> excluded
      fakeRule({ selectorText: ".ad-hero", display: "flex" }),
      fakeRule({ selectorText: ".unrelated", display: "none" }), // doesn't match -> excluded
    ],
  });
  const { matched, accessErrors } = collectMatchedDisplayRules(el, [sheet]);
  assert.equal(accessErrors.length, 0);
  assert.deepEqual(matched, [{ selectorText: ".ad-hero", display: "flex", priority: "", sheetHref: "https://example.com/app.css", media: null }]);
});

test("collectMatchedDisplayRules: recurses into @media blocks and records the condition text", () => {
  const el = fakeEl({ matchesSelectors: [".ad-hero"] });
  const sheet = fakeSheet({
    href: "(inline)",
    cssRules: [fakeMediaRule("(max-width: 640px)", [fakeRule({ selectorText: ".ad-hero", display: "none" })])],
  });
  const { matched } = collectMatchedDisplayRules(el, [sheet]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].media, "(max-width: 640px)");
  assert.equal(matched[0].display, "none");
});

test("collectMatchedDisplayRules: reports getPropertyPriority (e.g. !important)", () => {
  const el = fakeEl({ matchesSelectors: [".home-debug-outline-hero"] });
  const sheet = fakeSheet({
    cssRules: [fakeRule({ selectorText: ".home-debug-outline-hero", display: "block", priority: "important" })],
  });
  const { matched } = collectMatchedDisplayRules(el, [sheet]);
  assert.equal(matched[0].priority, "important");
});

test("collectMatchedDisplayRules: a stylesheet that throws on .cssRules access is recorded, not fatal", () => {
  const el = fakeEl({ matchesSelectors: [".ad-hero"] });
  const inaccessible = fakeSheet({ href: "https://fonts.googleapis.com/css2", throwsOnAccess: true });
  const accessible = fakeSheet({ cssRules: [fakeRule({ selectorText: ".ad-hero", display: "flex" })] });
  const { matched, accessErrors } = collectMatchedDisplayRules(el, [inaccessible, accessible]);
  assert.equal(accessErrors.length, 1);
  assert.equal(accessErrors[0].sheetHref, "https://fonts.googleapis.com/css2");
  assert.equal(matched.length, 1);
});

test("collectMatchedDisplayRules: an invalid selector (e.g. ::-webkit-scrollbar) is skipped, not fatal", () => {
  const el = { matches: () => { throw new DOMException("invalid selector"); } };
  const sheet = fakeSheet({ cssRules: [fakeRule({ selectorText: "::-webkit-scrollbar", display: "none" })] });
  assert.deepEqual(collectMatchedDisplayRules(el, [sheet]), { matched: [], accessErrors: [] });
});

// --- displayNoneSourceUnresolvedByAuthorCSS: the key diagnostic signal ---

test("displayNoneSourceUnresolvedByAuthorCSS: false when computed display isn't none", () => {
  const el = fakeEl({ matchesSelectors: [] });
  const result = describeDomNode(el, () => ({ display: "flex" }), []);
  assert.equal(result.displayNoneSourceUnresolvedByAuthorCSS, false);
});

test("displayNoneSourceUnresolvedByAuthorCSS: false when computed none AND an author rule explicitly declares display:none", () => {
  const el = fakeEl({ matchesSelectors: [".filters-panel"] });
  const sheet = fakeSheet({ cssRules: [fakeRule({ selectorText: ".filters-panel", display: "none" })] });
  const result = describeDomNode(el, () => ({ display: "none" }), [sheet]);
  assert.equal(result.displayNoneSourceUnresolvedByAuthorCSS, false);
  assert.equal(result.matchedDisplayRules.length, 1);
});

test("displayNoneSourceUnresolvedByAuthorCSS: true when computed none but NO matched author rule declares none — points at hidden attribute / UA stylesheet / other runtime mechanism", () => {
  const el = fakeEl({ matchesSelectors: [".ad-hero"] });
  // Only a rule setting display:flex matches — nothing in our own CSS says "none".
  const sheet = fakeSheet({ cssRules: [fakeRule({ selectorText: ".ad-hero", display: "flex" })] });
  const result = describeDomNode(el, () => ({ display: "none" }), [sheet]);
  assert.equal(result.displayNoneSourceUnresolvedByAuthorCSS, true);
});

test("displayNoneSourceUnresolvedByAuthorCSS: true when computed none and literally no rule matches at all", () => {
  const el = fakeEl({ matchesSelectors: [] });
  const result = describeDomNode(el, () => ({ display: "none" }), []);
  assert.equal(result.displayNoneSourceUnresolvedByAuthorCSS, true);
});

test("describeDomNode: full diagnostic never leaks user content, only technical/CSS strings", () => {
  const el = fakeEl({
    tagName: "SECTION",
    className: "ad-hero",
    textContent: "Bonjour Camille, réel contenu utilisateur",
    attributes: { style: "color:red" },
  });
  const serialized = JSON.stringify(describeDomNode(el, () => ({ display: "flex" }), []));
  assert.equal(serialized.includes("Camille"), false);
  assert.equal(serialized.includes("Bonjour"), false);
});
