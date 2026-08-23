// Temporary, query-string-gated diagnostic panel (?homeDebug=1) for
// investigating the connected-Accueil-render bug directly on the real
// Vercel deployment. Renders only booleans/counts/type-strings coming from
// lib/homeDebugSnapshot.js's buildHomeDebugSnapshot(), plus geometry/
// computed-style facts coming from lib/homeDomDiagnostics.js's
// collectHomeRuntimeDiagnostics() — never an email, user id, token, or any
// real garden/reminder/weather/profile content. Rendered from
// pages/index.js ABOVE AccueilDashboard so it stays visible even if
// AccueilDashboard renders nothing.
export function HomeDebugStyles() {
  return (
    <style>{`
      .home-debug-panel { background:#111;color:#0f0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;padding:14px 16px;border-radius:8px;margin-bottom:16px;white-space:pre-wrap; }
      .home-debug-title { font-weight:700;color:#fff;margin-bottom:6px;letter-spacing:0.5px; }
      .home-debug-subtitle { font-weight:700;color:#8cf;margin:12px 0 4px;letter-spacing:0.5px; }
      .home-debug-list { list-style:none; }
      .home-debug-marker { background:#222;color:#0af;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;padding:6px 10px;border-radius:6px;margin:8px 0;letter-spacing:0.5px; }
      .home-debug-error { background:#3a0d0d;color:#ffb4b4;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;padding:14px 16px;border-radius:8px;margin:8px 0; }
      .home-debug-stack { white-space:pre-wrap;font-size:11px;margin-top:8px;opacity:0.85; }
      .home-debug-fallback { background:#faf5e9;color:#6b4f1e;font-family:sans-serif;font-size:13px;padding:14px 16px;border-radius:8px;margin:8px 0; }
      .home-debug-unresolved { color:#ff0;font-weight:700; }
      .home-debug-rule { padding-left:16px; }
    `}</style>
  );
}

function NodeDiagnostic({ name, diag }) {
  if (!diag || !diag.exists) {
    return (
      <li>
        node[{name}]: exists=false
      </li>
    );
  }
  const c = diag.computed || {};
  const a = diag.attributes || {};
  const rules = diag.matchedDisplayRules || [];
  const errors = diag.styleSheetAccessErrors || [];
  return (
    <li>
      node[{name}]: exists=true tag={diag.tagName} children={diag.childElementCount} textLength={diag.textLength}{" "}
      isConnected={String(diag.isConnected)} clientRects={diag.clientRectsLength}
      <br />
      &nbsp;&nbsp;rect: x={Math.round(diag.rect.x)} y={Math.round(diag.rect.y)} w={Math.round(diag.rect.width)} h=
      {Math.round(diag.rect.height)}
      <br />
      &nbsp;&nbsp;offset: {diag.offsetWidth}x{diag.offsetHeight} client: {diag.clientWidth}x{diag.clientHeight}{" "}
      offsetParentPresent={String(diag.offsetParentPresent)}
      <br />
      &nbsp;&nbsp;computed: display={c.display} content={c.content} visibility={c.visibility} opacity={c.opacity}{" "}
      position={c.position} zIndex={c.zIndex}
      <br />
      &nbsp;&nbsp;computed: overflow={c.overflow}/{c.overflowX}/{c.overflowY} height={c.height} minHeight={c.minHeight}{" "}
      maxHeight={c.maxHeight} width={c.width}
      <br />
      &nbsp;&nbsp;computed: color={c.color} bg={c.backgroundColor} transform={c.transform} clip={c.clip} clipPath=
      {c.clipPath}
      <br />
      &nbsp;&nbsp;attrs: hiddenProperty={String(a.hiddenProperty)} hasHiddenAttribute={String(a.hasHiddenAttribute)}{" "}
      hiddenAttributeValue={String(a.hiddenAttributeValue)} ariaHidden={String(a.ariaHidden)} inert=
      {String(a.inertProperty)}
      <br />
      &nbsp;&nbsp;attrs: className="{a.className}" id="{a.id}" inlineStyle="{a.inlineStyle || ""}"
      <br />
      &nbsp;&nbsp;attrs: attributeNames=[{(a.attributeNames || []).join(", ")}]
      <br />
      &nbsp;&nbsp;
      {diag.displayNoneSourceUnresolvedByAuthorCSS ? (
        <span className="home-debug-unresolved">displayNoneSourceUnresolvedByAuthorCSS: true</span>
      ) : (
        <span>displayNoneSourceUnresolvedByAuthorCSS: false</span>
      )}
      <br />
      &nbsp;&nbsp;matchedDisplayRules ({rules.length}):
      {rules.map((r, i) => (
        <div className="home-debug-rule" key={i}>
          [{i}] {r.selectorText} {"->"} display:{r.display}{r.priority ? ` !${r.priority}` : ""} media=
          {r.media || "(none)"} sheet={r.sheetHref}
        </div>
      ))}
      {errors.length > 0 && (
        <>
          <br />
          &nbsp;&nbsp;styleSheetAccessErrors ({errors.length}):
          {errors.map((e, i) => (
            <div className="home-debug-rule" key={i}>
              [{i}] {e.sheetHref}: {e.message}
            </div>
          ))}
        </>
      )}
    </li>
  );
}

export default function HomeDebugPanel({ snapshot, domDiagnostics }) {
  return (
    <>
      <HomeDebugStyles />
      <div className="home-debug-panel">
        <div className="home-debug-title">HOME DEBUG</div>
        <ul className="home-debug-list">
          {Object.entries(snapshot).map(([key, value]) => (
            <li key={key}>
              {key}: {String(value)}
            </li>
          ))}
          <li>renderTimestamp: {new Date().toISOString()}</li>
        </ul>

        {domDiagnostics && (
          <>
            <div className="home-debug-subtitle">DOM NODES</div>
            <ul className="home-debug-list">
              {Object.entries(domDiagnostics.nodes || {}).map(([name, diag]) => (
                <NodeDiagnostic key={name} name={name} diag={diag} />
              ))}
            </ul>

            <div className="home-debug-subtitle">PARENT CHAIN (connected/disconnected-root → up)</div>
            <ul className="home-debug-list">
              {(domDiagnostics.parentChain || []).map((p, i) => (
                <li key={i}>
                  P{i} {p.label} | {Math.round(p.rectWidth)}x{Math.round(p.rectHeight)} | {p.display} | {p.visibility} |{" "}
                  {p.opacity} | {p.position} | {p.overflow}
                </li>
              ))}
              {(!domDiagnostics.parentChain || domDiagnostics.parentChain.length === 0) && <li>(no root found)</li>}
            </ul>

            <div className="home-debug-subtitle">ELEMENTS AT ROOT CENTER (elementsFromPoint, top 5)</div>
            <ul className="home-debug-list">
              {(domDiagnostics.elementsAtPoint || []).map((label, i) => (
                <li key={i}>
                  {i}: {label}
                </li>
              ))}
              {(!domDiagnostics.elementsAtPoint || domDiagnostics.elementsAtPoint.length === 0) && <li>(not probed — root missing or zero-size)</li>}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
