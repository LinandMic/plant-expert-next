// Pure runtime DOM diagnostic helpers for the ?homeDebug=1 investigation
// (spec: "Add runtime home DOM diagnostics"). Every function here takes
// already-obtained DOM-like objects (or injected document/getComputedStyle
// implementations) as arguments rather than reaching for `window`/
// `document` itself — that's what keeps them callable from plain
// `node --test` with small mock objects, no jsdom/browser test runner
// needed. Nothing here ever reads or returns text content, only its
// length, and only CSS/geometry values — never a real garden/reminder/
// profile value.

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

// describeDomNode(el, getComputedStyleFn) -> a plain, JSON-serializable
// diagnostic object. A missing node (null/undefined) safely reports
// {exists:false} instead of throwing. Only textLength (a number) is
// reported — never the text itself.
export function describeDomNode(el, getComputedStyleFn) {
  if (!el) return { exists: false };

  const textContent = typeof el.textContent === "string" ? el.textContent : "";

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
    isConnected: Boolean(el.isConnected),
    clientRectsLength: safeClientRectsLength(el),
    computed: safeComputedStyle(el, getComputedStyleFn),
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

// collectHomeRuntimeDiagnostics(nodeNames, { documentRef, getComputedStyleFn })
// -> { nodes: { [name]: diagnostic }, parentChain, elementsAtPoint }.
// The single orchestration entry point pages/index.js calls (client-only,
// inside a useEffect gated by ?homeDebug=1). Injecting documentRef/
// getComputedStyleFn instead of reaching for the globals directly is what
// makes this testable with plain mock objects.
export function collectHomeRuntimeDiagnostics(nodeNames, { documentRef, getComputedStyleFn } = {}) {
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
    nodes[name] = describeDomNode(el, getComputedStyleFn);
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
