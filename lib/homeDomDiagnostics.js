// Pure runtime DOM diagnostic helpers for the ?homeDebug=1 investigation
// (spec: "Trace runtime source of hidden home sections"). Every function
// here takes already-obtained DOM-like objects (or injected document/
// getComputedStyle/styleSheets implementations) as arguments rather than
// reaching for `window`/`document` itself — that's what keeps them
// callable from plain `node --test` with small mock objects, no jsdom/
// browser test runner needed. Nothing here ever reads or returns text
// content or attribute VALUES beyond a fixed, known-safe allowlist
// (hidden/aria-hidden/style/class/id — never a real garden/reminder/
// profile value), and attribute NAMES only (never other attribute values).

// describeElementLabel(el) -> "tag.firstClass" (no id, no other
// attributes, never user content).
export function describeElementLabel(el) {
  if (!el) return "(null)";
  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "?";
  const rawClass = typeof el.className === "string" ? el.className.trim() : "";
  const firstClass = rawClass ? "." + rawClass.split(/\s+/)[0] : "";
  return `${tag}${firstClass}`;
}

const COMPUTED_STYLE_KEYS = [
  "display",
  "content",
  "visibility",
  "opacity",
  "position",
  "zIndex",
  "overflow",
  "overflowX",
  "overflowY",
  "height",
  "minHeight",
  "maxHeight",
  "width",
  "color",
  "backgroundColor",
  "transform",
  "clip",
  "clipPath",
];

function safeComputedStyle(el, getComputedStyleFn) {
  if (!el || typeof getComputedStyleFn !== "function") return {};
  try {
    const cs = getComputedStyleFn(el);
    if (!cs) return {};
    const out = {};
    for (const key of COMPUTED_STYLE_KEYS) {
      out[key] = cs[key] ?? null;
    }
    return out;
  } catch {
    // A style read that throws (unsupported environment, detached node,
    // etc.) must never take down the rest of the diagnostic panel.
    return {};
  }
}

function safeRect(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  try {
    const r = el.getBoundingClientRect();
    return { x: r.x ?? 0, y: r.y ?? 0, width: r.width ?? 0, height: r.height ?? 0 };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function safeClientRectsLength(el) {
  if (!el || typeof el.getClientRects !== "function") return 0;
  try {
    const list = el.getClientRects();
    return list ? list.length : 0;
  } catch {
    return 0;
  }
}

// describeRuntimeAttributes(el) -> the exact set of runtime facts asked
// for in the "hidden / user-agent stylesheet" investigation. Only a fixed
// allowlist of attribute VALUES is ever read (hidden/aria-hidden/style/
// class/id, all of which are technical, developer-controlled strings —
// never user data); getAttributeNames() reports NAMES only, never values.
function describeRuntimeAttributes(el) {
  if (!el) return null;

  let attributeNames = [];
  try {
    attributeNames = typeof el.getAttributeNames === "function" ? el.getAttributeNames() : [];
  } catch {
    attributeNames = [];
  }

  const getAttr = (name) => {
    try {
      return typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
    } catch {
      return null;
    }
  };
  const hasAttr = (name) => {
    try {
      return typeof el.hasAttribute === "function" ? el.hasAttribute(name) : false;
    } catch {
      return false;
    }
  };

  return {
    hiddenProperty: Boolean(el.hidden),
    hasHiddenAttribute: hasAttr("hidden"),
    hiddenAttributeValue: getAttr("hidden"),
    ariaHidden: getAttr("aria-hidden"),
    inertProperty: "inert" in el ? Boolean(el.inert) : null,
    className: typeof el.className === "string" ? el.className : "",
    id: typeof el.id === "string" ? el.id : "",
    inlineStyle: getAttr("style"),
    attributeNames: Array.isArray(attributeNames) ? attributeNames : [],
  };
}

// CSSRule.MEDIA_RULE is 4 per the DOM spec; hardcoded (not read from a
// global CSSRule) so this stays callable from plain node --test mocks.
const MEDIA_RULE_TYPE = 4;

function walkRuleListForDisplay(ruleList, el, sheetHref, mediaCtx, matched) {
  for (const rule of Array.from(ruleList || [])) {
    if (rule.type === MEDIA_RULE_TYPE && rule.cssRules) {
      walkRuleListForDisplay(rule.cssRules, el, sheetHref, rule.conditionText || null, matched);
      continue;
    }
    if (!rule.selectorText || !rule.style) continue;

    const displayValue =
      typeof rule.style.getPropertyValue === "function" ? rule.style.getPropertyValue("display") : rule.style.display;
    if (!displayValue) continue; // only rules that actually declare `display`

    let does = false;
    try {
      does = typeof el.matches === "function" ? el.matches(rule.selectorText) : false;
    } catch {
      continue; // an invalid/unsupported selector (e.g. ::-webkit-scrollbar) never crashes the scan
    }
    if (!does) continue;

    const priority =
      typeof rule.style.getPropertyPriority === "function" ? rule.style.getPropertyPriority("display") : "";

    matched.push({
      selectorText: rule.selectorText,
      display: displayValue,
      priority: priority || "",
      sheetHref: sheetHref || "(inline)",
      media: mediaCtx,
    });
  }
}

// collectMatchedDisplayRules(el, styleSheetsRef) -> { matched, accessErrors }
// Walks every accessible stylesheet (including nested @media blocks) and
// keeps only the rules that (a) match `el` and (b) declare a `display`
// value — this is what answers "which author CSS rule, if any, is
// actually responsible for this element's computed display". A
// stylesheet that throws on `.cssRules` access (cross-origin, detached,
// etc.) is recorded in `accessErrors` instead of aborting the scan.
export function collectMatchedDisplayRules(el, styleSheetsRef) {
  const matched = [];
  const accessErrors = [];
  if (!el || !styleSheetsRef) return { matched, accessErrors };

  for (const sheet of Array.from(styleSheetsRef)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      accessErrors.push({ sheetHref: sheet.href || "(inline)", message: e && e.message ? String(e.message) : "access denied" });
      continue;
    }
    if (!rules) continue;
    walkRuleListForDisplay(rules, el, sheet.href || "(inline)", null, matched);
  }

  return { matched, accessErrors };
}

// describeDomNode(el, getComputedStyleFn, styleSheetsRef) -> a plain,
// JSON-serializable diagnostic object. A missing node (null/undefined)
// safely reports {exists:false} instead of throwing. Only textLength (a
// number) is reported — never the text itself. When computed display is
// "none" and no matched author rule actually declares display:none,
// `displayNoneSourceUnresolvedByAuthorCSS` is set to true — the signal
// that something outside our own CSS (hidden attribute, user-agent
// stylesheet, an inaccessible stylesheet, or another runtime mechanism)
// is responsible.
export function describeDomNode(el, getComputedStyleFn, styleSheetsRef) {
  if (!el) return { exists: false };

  const textContent = typeof el.textContent === "string" ? el.textContent : "";
  const computed = safeComputedStyle(el, getComputedStyleFn);
  const { matched: matchedDisplayRules, accessErrors: styleSheetAccessErrors } = styleSheetsRef
    ? collectMatchedDisplayRules(el, styleSheetsRef)
    : { matched: [], accessErrors: [] };

  const computedDisplay = computed.display ?? null;
  const anyAuthorRuleSaysNone = matchedDisplayRules.some((r) => (r.display || "").trim() === "none");
  const displayNoneSourceUnresolvedByAuthorCSS = computedDisplay === "none" && !anyAuthorRuleSaysNone;

  let offsetParentPresent = null;
  try {
    offsetParentPresent = "offsetParent" in el ? el.offsetParent !== null : null;
  } catch {
    offsetParentPresent = null;
  }

  return {
    exists: true,
    tagName: typeof el.tagName === "string" ? el.tagName : null,
    childElementCount: typeof el.childElementCount === "number" ? el.childElementCount : 0,
    textLength: textContent.length,
    rect: safeRect(el),
    offsetWidth: typeof el.offsetWidth === "number" ? el.offsetWidth : 0,
    offsetHeight: typeof el.offsetHeight === "number" ? el.offsetHeight : 0,
    clientWidth: typeof el.clientWidth === "number" ? el.clientWidth : 0,
    clientHeight: typeof el.clientHeight === "number" ? el.clientHeight : 0,
    offsetParentPresent,
    isConnected: Boolean(el.isConnected),
    clientRectsLength: safeClientRectsLength(el),
    computed,
    attributes: describeRuntimeAttributes(el),
    matchedDisplayRules,
    styleSheetAccessErrors,
    displayNoneSourceUnresolvedByAuthorCSS,
  };
}

// describeParentChain(el, maxDepth, getComputedStyleFn) -> up to maxDepth
// compact parent descriptors, starting from el's immediate parent. Never
// throws on a node missing `parentElement`.
export function describeParentChain(el, maxDepth, getComputedStyleFn) {
  const chain = [];
  let node = el && el.parentElement ? el.parentElement : null;
  let depth = 0;
  while (node && depth < maxDepth) {
    const rect = safeRect(node);
    const computed = safeComputedStyle(node, getComputedStyleFn);
    chain.push({
      label: describeElementLabel(node),
      rectWidth: rect.width,
      rectHeight: rect.height,
      display: computed.display ?? null,
      visibility: computed.visibility ?? null,
      opacity: computed.opacity ?? null,
      position: computed.position ?? null,
      overflow: computed.overflow ?? null,
    });
    node = node.parentElement || null;
    depth += 1;
  }
  return chain;
}

// summarizeElementsAtPoint(elements, limit) -> up to `limit` compact
// labels ("tag.class"), never any attribute/content beyond that.
export function summarizeElementsAtPoint(elements, limit = 5) {
  if (!Array.isArray(elements)) return [];
  return elements.slice(0, limit).map(describeElementLabel);
}

// collectHomeRuntimeDiagnostics(nodeNames, { documentRef, getComputedStyleFn, styleSheetsRef })
// -> { nodes: { [name]: diagnostic }, parentChain, elementsAtPoint }.
// The single orchestration entry point pages/index.js calls (client-only,
// inside a useEffect gated by ?homeDebug=1). Injecting documentRef/
// getComputedStyleFn/styleSheetsRef instead of reaching for the globals
// directly is what makes this testable with plain mock objects.
export function collectHomeRuntimeDiagnostics(nodeNames, { documentRef, getComputedStyleFn, styleSheetsRef } = {}) {
  if (!documentRef || typeof documentRef.querySelector !== "function") {
    return { nodes: {}, parentChain: [], elementsAtPoint: [] };
  }

  const nodes = {};
  for (const name of nodeNames || []) {
    let el = null;
    try {
      el = documentRef.querySelector(`[data-home-node="${name}"]`);
    } catch {
      el = null;
    }
    nodes[name] = describeDomNode(el, getComputedStyleFn, styleSheetsRef);
  }

  const rootDiag = nodes["connected-root"] || nodes["disconnected-root"] || null;
  let rootEl = null;
  try {
    rootEl =
      documentRef.querySelector('[data-home-node="connected-root"]') ||
      documentRef.querySelector('[data-home-node="disconnected-root"]');
  } catch {
    rootEl = null;
  }
  const parentChain = rootEl ? describeParentChain(rootEl, 6, getComputedStyleFn) : [];

  let elementsAtPoint = [];
  if (
    rootDiag &&
    rootDiag.exists &&
    rootDiag.rect.width > 0 &&
    rootDiag.rect.height > 0 &&
    typeof documentRef.elementsFromPoint === "function"
  ) {
    const x = rootDiag.rect.x + rootDiag.rect.width / 2;
    const y = rootDiag.rect.y + Math.min(rootDiag.rect.height / 2, 100);
    try {
      elementsAtPoint = summarizeElementsAtPoint(documentRef.elementsFromPoint(x, y), 5);
    } catch {
      elementsAtPoint = [];
    }
  }

  return { nodes, parentChain, elementsAtPoint };
}
