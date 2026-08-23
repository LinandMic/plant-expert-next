import { useEffect, useRef, useState } from "react";
import PlantFinderCard from "@/components/PlantFinderCard";
import { searchPublishedPlants } from "@/lib/plantFinderApi";

const SEARCH_DEBOUNCE_MS = 300;

export default function PlantFinderPage() {
  const [query, setQuery] = useState("");
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const results = await searchPublishedPlants(query);
        if (requestIdRef.current !== requestId) return;
        setPlants(results);
        setLoading(false);
      } catch {
        if (requestIdRef.current !== requestId) return;
        // Never surface the raw Supabase error to the visitor.
        setError("Impossible de charger les plantes pour le moment.");
        setLoading(false);
      }
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --ink:#0f1f0f;--forest:#1e3a1e;--moss:#3a6b3a;--sage:#7aad7a;--mist:#e8f0e8;--paper:#f4f2ed;--cream:#faf8f3;--gold:#c4962a;--rust:#8b3a1e;--r:14px;--shadow:0 4px 20px rgba(15,31,15,0.1); }
        body { font-family:'Outfit',sans-serif;background:var(--paper);color:var(--ink); }
        .app { min-height:100vh;padding-bottom:80px; }
        .header { background:var(--forest);padding:24px 20px 16px; }
        .header h1 { font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:white; }
        .header h1 em { color:var(--sage);font-style:normal; }
        .header p { color:rgba(255,255,255,0.45);font-size:12px;margin-top:3px; }
        .tab-page { padding:16px 16px 20px;max-width:680px;margin:0 auto; }
        .modal-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest);font-weight:700;margin-bottom:4px; }
        .modal-sub { color:#999;font-size:13px;margin-bottom:20px;line-height:1.5; }
        .auth-label { font-size:11px;font-weight:600;color:var(--forest);margin-bottom:5px;display:block; }
        .filters-row { margin-bottom:16px; }
        .search-input { width:100%;border:1.5px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:14px;outline:none;background:white; }
        .search-input:focus { border-color:var(--moss); }
        .error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:12px 14px;color:var(--rust);font-size:14px; }
        .loading-state { text-align:center;padding:60px 20px; }
        .leaf-spin { font-size:48px;display:inline-block;animation:spin 2s linear infinite;margin-bottom:14px; }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        .loading-title { font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--forest); }
        .empty-jardin { text-align:center;padding:80px 20px; }
        .empty-icon { font-size:56px;margin-bottom:14px; }
        .empty-title { font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--forest);margin-bottom:6px; }
        .pf-grid { display:flex;flex-direction:column;gap:10px; }
        .pf-card { display:block;background:white;border-radius:var(--r);padding:14px 16px;box-shadow:var(--shadow);border:1px solid rgba(0,0,0,0.06);text-decoration:none;color:inherit;transition:transform 0.15s; }
        .pf-card:focus-visible { outline:2px solid var(--moss);outline-offset:2px; }
        @media (hover: hover) and (pointer: fine) { .pf-card:hover { transform:translateY(-1px); } }
        .pf-card-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px; }
        .pf-card-name { font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:700;color:var(--ink); }
        .pf-badge { flex-shrink:0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;white-space:nowrap; }
        .pf-badge-species { background:var(--mist);color:var(--moss); }
        .pf-badge-cultivar { background:#fdf3e0;color:#8a6a1e; }
        .pf-card-common { font-size:12px;color:#999;font-style:italic;margin-top:2px; }
        .pf-card-meta { display:flex;flex-wrap:wrap;gap:6px;margin-top:8px; }
        .pf-card-tag { background:var(--cream);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--forest);font-weight:500; }
        .back-btn { display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;padding:0;margin-top:20px;font-weight:500;text-decoration:none; }
        .bottom-nav { position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid rgba(0,0,0,0.1);display:flex;z-index:100;box-shadow:0 -4px 20px rgba(0,0,0,0.08); }
        .nav-item { flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 4px 12px;cursor:pointer;border:none;background:none;font-family:'Outfit',sans-serif;color:#bbb;font-size:11px;transition:color 0.2s;gap:3px;position:relative;text-decoration:none; }
        .nav-item.active { color:var(--moss); }
        .nav-icon { font-size:22px; }
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Botaniste IA · Identification & Mon Jardin</p>
      </div>

      <div className="tab-page">
        <h2 className="modal-title">Trouver une plante</h2>
        <p className="modal-sub">Recherchez une plante par son nom et découvrez ses caractéristiques.</p>

        <div className="filters-row">
          <label htmlFor="plant-finder-search" className="auth-label">Rechercher une plante</label>
          <input
            id="plant-finder-search"
            type="search"
            className="search-input"
            placeholder="Rechercher une plante…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        {loading ? (
          <div className="loading-state">
            <div className="leaf-spin">🌿</div>
            <div className="loading-title">Recherche en cours...</div>
          </div>
        ) : error ? (
          <div className="error-box">{error}</div>
        ) : plants.length === 0 ? (
          <div className="empty-jardin">
            <div className="empty-icon">🌱</div>
            <div className="empty-title">
              {query.trim() ? "Aucune plante ne correspond à votre recherche." : "Aucune plante disponible pour le moment."}
            </div>
          </div>
        ) : (
          <div className="pf-grid">
            {plants.map((plant) => (
              <PlantFinderCard key={plant.id} plant={plant} />
            ))}
          </div>
        )}

        <a href="/" className="back-btn">← Retour à Plant Expert</a>
      </div>

      <nav className="bottom-nav">
        <a href="/" className="nav-item">
          <span className="nav-icon">🔍</span>Identifier
        </a>
        <a href="/" className="nav-item">
          <span className="nav-icon">🌳</span>Mon Jardin
        </a>
        <a href="/plant-finder" className="nav-item active">
          <span className="nav-icon">🔎</span>Trouver une plante
        </a>
      </nav>
    </div>
  );
}
