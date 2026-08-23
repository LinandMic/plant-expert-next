// Temporary, query-string-gated diagnostic panel (?homeDebug=1) for
// investigating the connected-Accueil-render bug directly on the real
// Vercel deployment. Renders only booleans/counts/type-strings coming from
// lib/homeDebugSnapshot.js's buildHomeDebugSnapshot() — never an email,
// user id, token, or any real garden/reminder/weather content. Rendered
// from pages/index.js ABOVE AccueilDashboard so it stays visible even if
// AccueilDashboard renders nothing.
export function HomeDebugStyles() {
  return (
    <style>{`
      .home-debug-panel { background:#111;color:#0f0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;padding:14px 16px;border-radius:8px;margin-bottom:16px;white-space:pre-wrap; }
      .home-debug-title { font-weight:700;color:#fff;margin-bottom:6px;letter-spacing:0.5px; }
      .home-debug-list { list-style:none; }
      .home-debug-marker { background:#222;color:#0af;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;padding:6px 10px;border-radius:6px;margin:8px 0;letter-spacing:0.5px; }
      .home-debug-error { background:#3a0d0d;color:#ffb4b4;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;padding:14px 16px;border-radius:8px;margin:8px 0; }
      .home-debug-stack { white-space:pre-wrap;font-size:11px;margin-top:8px;opacity:0.85; }
      .home-debug-fallback { background:#faf5e9;color:#6b4f1e;font-family:sans-serif;font-size:13px;padding:14px 16px;border-radius:8px;margin:8px 0; }
    `}</style>
  );
}

export default function HomeDebugPanel({ snapshot }) {
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
      </div>
    </>
  );
}
