import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import PlantFinderCard from "@/components/PlantFinderCard";
import { searchPublishedPlants } from "@/lib/plantFinderApi";
import {
  plantTypeLabel,
  sunLabel,
  heightCategoryLabel,
  PLANT_TYPE_VALUES,
  SUN_VALUES,
  HEIGHT_CATEGORY_VALUES,
} from "@/lib/plantFinderFormat";
import {
  parseFiltersFromQuery,
  serializeFiltersToQuery,
  formatResultCount,
  removeActiveFilter,
  resetFilters,
  clearAllFilters,
} from "@/lib/plantFinderFilters";

const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_FILTERS = { query: "", plantType: null, sun: null, heightCategory: null };

export default function PlantFinderPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestIdRef = useRef(0);

  // The URL is the source of truth: on first ready render, seed filter
  // state from the query string (back-button, refresh, and shared links
  // all land here) — only once, so our own router.replace() below never
  // re-triggers this.
  useEffect(() => {
    if (!router.isReady || initialized) return;
    const parsed = parseFiltersFromQuery(router.query);
    setQueryInput(parsed.query);
    setFilters(parsed);
    setInitialized(true);
  }, [router.isReady, initialized, router.query]);

  // Debounce the text input into filters.query — discrete filter changes
  // (type/sun/height) are not debounced, only free text typing is.
  useEffect(() => {
    if (!initialized) return;
    const trimmed = queryInput.trim();
    if (trimmed === filters.query) return;
    const timer = setTimeout(() => {
      setFilters((f) => ({ ...f, query: trimmed }));
    }, trimmed ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput, initialized]);

  // Fetch + sync the URL whenever the settled filter state changes.
  useEffect(() => {
    if (!initialized) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    router.replace({ pathname: "/plant-finder", query: serializeFiltersToQuery(filters) }, undefined, { shallow: true });

    searchPublishedPlants({
      query: filters.query,
      plantType: filters.plantType,
      sun: filters.sun,
      heightCategory: filters.heightCategory,
    })
      .then((results) => {
        if (requestIdRef.current !== requestId) return;
        setPlants(results);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        // Never surface the raw Supabase error to the visitor.
        setError("Impossible de charger les plantes pour le moment.");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, filters]);

  function handleTypeChange(e) {
    const value = e.target.value;
    setFilters((f) => ({ ...f, plantType: value || null }));
  }

  function handleSunToggle(value) {
    setFilters((f) => {
      const current = f.sun || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...f, sun: next.length > 0 ? next : null };
    });
  }

  function handleHeightChange(e) {
    const value = e.target.value;
    setFilters((f) => ({ ...f, heightCategory: value || null }));
  }

  function handleRemoveChip(key, value) {
    setFilters((f) => removeActiveFilter(f, key, value));
  }

  function handleResetFilters() {
    setFilters((f) => resetFilters(f));
  }

  function handleClearAll() {
    const cleared = clearAllFilters();
    setQueryInput(cleared.query);
    setFilters(cleared);
  }

  const activeSun = filters.sun || [];
  const activeCount = (filters.plantType ? 1 : 0) + activeSun.length + (filters.heightCategory ? 1 : 0);
  const hasActiveCriteria = Boolean(filters.query || filters.plantType || activeSun.length > 0 || filters.heightCategory);

  const chips = [];
  if (filters.plantType) chips.push({ key: "plantType", value: null, label: plantTypeLabel(filters.plantType) });
  activeSun.forEach((value) => chips.push({ key: "sun", value, label: sunLabel(value) }));
  if (filters.heightCategory) chips.push({ key: "height", value: null, label: heightCategoryLabel(filters.heightCategory) });

  const returnTo = new URLSearchParams(serializeFiltersToQuery(filters)).toString();

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
        .filters-row { margin-bottom:12px; }
        .search-input { width:100%;border:1.5px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:14px;outline:none;background:white; }
        .search-input:focus { border-color:var(--moss); }
        select.search-input { appearance:auto; }

        .filters-toggle { display:flex;align-items:center;gap:6px;background:white;border:1.5px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;color:var(--forest);cursor:pointer;margin-bottom:10px;min-height:40px; }
        .filters-toggle:focus-visible { outline:2px solid var(--moss);outline-offset:2px; }
        .filters-toggle[aria-expanded="true"] { border-color:var(--moss); }

        .filters-panel { display:none; }
        .filters-panel.open { display:flex;flex-direction:column;gap:14px; }
        .filters-panel-inner { background:var(--cream);border-radius:var(--r);padding:14px;display:flex;flex-direction:column;gap:14px;margin-bottom:14px; }

        .filter-fieldset { border:none;padding:0;margin:0; }
        .filter-legend { font-size:11px;font-weight:600;color:var(--forest);margin-bottom:6px;padding:0; }
        .chip-options { display:flex;flex-wrap:wrap;gap:8px; }
        .chip-checkbox { display:flex;align-items:center;gap:6px;background:white;border:1.5px solid rgba(0,0,0,0.1);border-radius:20px;padding:8px 12px;font-size:13px;color:var(--ink);cursor:pointer;min-height:36px; }
        .chip-checkbox:has(input:checked) { border-color:var(--moss);background:var(--mist);color:var(--forest);font-weight:600; }
        .chip-checkbox input { width:16px;height:16px;accent-color:var(--moss); }

        .filter-actions { display:flex;flex-wrap:wrap;gap:10px; }
        .filter-reset-btn, .filter-clear-btn { background:none;border:1.5px solid rgba(0,0,0,0.12);border-radius:8px;padding:8px 12px;font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;color:var(--moss);cursor:pointer;min-height:36px; }
        .filter-clear-btn { color:var(--rust);border-color:rgba(139,58,30,0.2); }
        .filter-reset-btn:focus-visible, .filter-clear-btn:focus-visible { outline:2px solid var(--moss);outline-offset:2px; }

        .active-chips { display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px; }
        .active-chip { display:flex;align-items:center;gap:6px;background:var(--mist);color:var(--forest);border:none;border-radius:20px;padding:7px 12px;font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;min-height:32px; }
        .active-chip:focus-visible { outline:2px solid var(--moss);outline-offset:2px; }

        .result-count { font-size:12px;color:#999;margin-bottom:10px;font-weight:500; }

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

        @media (min-width: 768px) {
          .filters-toggle { display:none; }
          .filters-panel { display:flex !important;flex-direction:column;gap:14px; }
        }
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
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            autoComplete="off"
          />
        </div>

        <button
          type="button"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="plant-finder-filters-panel"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          ⚙️ Filtres{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>

        <div id="plant-finder-filters-panel" className={"filters-panel" + (filtersOpen ? " open" : "")}>
          <div className="filters-panel-inner">
            <div>
              <label htmlFor="pf-filter-type" className="auth-label">Type de plante</label>
              <select id="pf-filter-type" className="search-input" value={filters.plantType || ""} onChange={handleTypeChange}>
                <option value="">Tous les types</option>
                {PLANT_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>{plantTypeLabel(value)}</option>
                ))}
              </select>
            </div>

            <fieldset className="filter-fieldset">
              <legend className="filter-legend">Exposition</legend>
              <div className="chip-options">
                {SUN_VALUES.map((value) => (
                  <label key={value} className="chip-checkbox">
                    <input
                      type="checkbox"
                      checked={activeSun.includes(value)}
                      onChange={() => handleSunToggle(value)}
                    />
                    <span>{sunLabel(value)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="pf-filter-height" className="auth-label">Hauteur adulte</label>
              <select id="pf-filter-height" className="search-input" value={filters.heightCategory || ""} onChange={handleHeightChange}>
                <option value="">Toutes les hauteurs</option>
                {HEIGHT_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>{heightCategoryLabel(value)}</option>
                ))}
              </select>
            </div>

            <div className="filter-actions">
              <button type="button" className="filter-reset-btn" onClick={handleResetFilters}>Réinitialiser les filtres</button>
              <button type="button" className="filter-clear-btn" onClick={handleClearAll}>Tout effacer</button>
            </div>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="active-chips" aria-label="Filtres actifs">
            {chips.map((chip) => (
              <button
                key={`${chip.key}-${chip.value || "single"}`}
                type="button"
                className="active-chip"
                onClick={() => handleRemoveChip(chip.key, chip.value)}
                aria-label={`Retirer le filtre ${chip.label}`}
              >
                {chip.label} ×
              </button>
            ))}
          </div>
        )}

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
              {hasActiveCriteria ? "Aucune plante ne correspond à votre recherche." : "Aucune plante disponible pour le moment."}
            </div>
          </div>
        ) : (
          <>
            <div className="result-count">{formatResultCount(plants.length)}</div>
            <div className="pf-grid">
              {plants.map((plant) => (
                <PlantFinderCard key={plant.id} plant={plant} returnTo={returnTo} />
              ))}
            </div>
          </>
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
