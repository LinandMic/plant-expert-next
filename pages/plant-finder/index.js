import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "@/components/ui/AppShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
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
import { IconSprig, IconX, IconFilter, IconSearch } from "@/components/ui/icons";
import { EXTERNAL_NAV_ITEMS } from "@/components/ui/externalNavItems";

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
    <AppShell navItems={EXTERNAL_NAV_ITEMS} activeKey="trouver">
      <div className="pf2-page">
        <style>{FINDER_STYLES}</style>

        <header className="pf2-header">
          <div className="pf2-eyebrow">TROUVER</div>
          <h1 className="pf2-title">Trouvez la plante idéale</h1>
          <p className="pf2-subtitle">Explorez le catalogue selon vos envies et les conditions de votre jardin.</p>
        </header>

        <div className="pf2-search-row">
          <div className="pf2-search-field">
            <IconSearch size={17} />
            <input
              type="search"
              className="pf2-search-input"
              placeholder="Rechercher une plante…"
              aria-label="Rechercher une plante"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              autoComplete="off"
            />
            {queryInput && (
              <button type="button" className="pf2-search-clear" onClick={() => setQueryInput("")} aria-label="Effacer la recherche">
                <IconX size={15} />
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="pf2-filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="pf2-filters-panel"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <IconFilter size={16} />
          Filtres{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>

        <div className="pf2-layout">
          <aside id="pf2-filters-panel" className={"pf2-sidebar" + (filtersOpen ? " open" : "")}>
            <Card className="pf2-sidebar-inner">
              <div className="pf2-sidebar-title">Filtres</div>

              <div className="pf2-filter-group">
                <div className="pf2-filter-label" id="pf2-type-label">Type</div>
                <div className="pf2-pill-row" role="group" aria-labelledby="pf2-type-label">
                  <label className="pf2-pill">
                    <input type="radio" name="pf2-type" value="" checked={!filters.plantType} onChange={handleTypeChange} />
                    <span>Tous</span>
                  </label>
                  {PLANT_TYPE_VALUES.map((value) => (
                    <label key={value} className="pf2-pill">
                      <input type="radio" name="pf2-type" value={value} checked={filters.plantType === value} onChange={handleTypeChange} />
                      <span>{plantTypeLabel(value)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <fieldset className="pf2-filter-group pf2-fieldset">
                <legend className="pf2-filter-label">Exposition</legend>
                <div className="pf2-pill-row">
                  {SUN_VALUES.map((value) => (
                    <label key={value} className="pf2-pill">
                      <input type="checkbox" checked={activeSun.includes(value)} onChange={() => handleSunToggle(value)} />
                      <span>{sunLabel(value)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="pf2-filter-group">
                <div className="pf2-filter-label" id="pf2-height-label">Hauteur adulte</div>
                <div className="pf2-pill-row" role="group" aria-labelledby="pf2-height-label">
                  <label className="pf2-pill">
                    <input type="radio" name="pf2-height" value="" checked={!filters.heightCategory} onChange={handleHeightChange} />
                    <span>Toutes</span>
                  </label>
                  {HEIGHT_CATEGORY_VALUES.map((value) => (
                    <label key={value} className="pf2-pill">
                      <input type="radio" name="pf2-height" value={value} checked={filters.heightCategory === value} onChange={handleHeightChange} />
                      <span>{heightCategoryLabel(value)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pf2-sidebar-actions">
                <button type="button" className="pf2-reset-btn" onClick={handleResetFilters}>Réinitialiser les filtres</button>
                <button type="button" className="pf2-clear-btn" onClick={handleClearAll}>Tout effacer</button>
              </div>

              <button type="button" className="pf2-panel-close-btn" onClick={() => setFiltersOpen(false)}>
                Voir les résultats
              </button>
            </Card>
          </aside>

          <div className="pf2-results">
            {chips.length > 0 && (
              <div className="pf2-chips" aria-label="Filtres actifs">
                {chips.map((chip) => (
                  <button
                    key={`${chip.key}-${chip.value || "single"}`}
                    type="button"
                    className="pf2-chip"
                    onClick={() => handleRemoveChip(chip.key, chip.value)}
                    aria-label={`Retirer le filtre ${chip.label}`}
                  >
                    {chip.label} <IconX size={12} />
                  </button>
                ))}
              </div>
            )}

            {!loading && !error && plants.length > 0 && (
              <div className="pf2-result-count">{formatResultCount(plants.length)}</div>
            )}

            {loading ? (
              <div className="pf2-loading" role="status" aria-live="polite">
                <div className="pf2-spinner" aria-hidden="true" />
                <div className="pf2-loading-title">Recherche en cours…</div>
              </div>
            ) : error ? (
              <div className="pf2-error-box">{error}</div>
            ) : plants.length === 0 ? (
              <Card className="pf2-empty-card">
                <IconSprig size={26} />
                <div className="pf2-empty-title">
                  {hasActiveCriteria ? "Aucune plante ne correspond" : "Aucune plante disponible pour le moment"}
                </div>
                {hasActiveCriteria && (
                  <>
                    <p className="pf2-empty-sub">Essayez d&apos;élargir vos critères de recherche.</p>
                    <Button variant="secondary" onClick={handleClearAll}>Réinitialiser les filtres</Button>
                  </>
                )}
              </Card>
            ) : (
              <div className="pf2-grid">
                {plants.map((plant) => (
                  <PlantFinderCard key={plant.id} plant={plant} returnTo={returnTo} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const FINDER_STYLES = `
  .pf2-page { max-width:100%; }
  .pf2-header { margin-bottom:24px;padding-bottom:22px;border-bottom:1px solid var(--pe-border); }
  .pf2-eyebrow { font:var(--pe-text-small);color:var(--pe-accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700; }
  .pf2-title { margin-top:6px;font-family:var(--pe-font-display);font-weight:600;font-size:clamp(26px,3.2vw,40px);color:var(--pe-text);line-height:1.1; }
  .pf2-subtitle { margin-top:8px;font:var(--pe-text-body);color:var(--pe-text-muted);max-width:520px; }
  @media (max-width:640px) { .pf2-header { padding-bottom:16px;margin-bottom:20px; } }

  .pf2-search-row { margin-bottom:14px; }
  .pf2-search-field { display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);height:50px; }
  .pf2-search-field:focus-within { border-color:var(--pe-accent); }
  .pf2-search-input { flex:1;border:none;outline:none;background:transparent;font:var(--pe-text-body);color:var(--pe-text);height:100%; }
  .pf2-search-input::placeholder { color:var(--pe-text-muted); }
  .pf2-search-clear { display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:none;background:var(--pe-sand);color:var(--pe-text-muted);cursor:pointer;flex-shrink:0; }
  .pf2-search-clear:hover { color:var(--pe-text); }

  .pf2-filters-toggle { display:flex;align-items:center;gap:8px;width:100%;padding:12px 16px;min-height:44px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-body);font-weight:600;cursor:pointer;margin-bottom:16px; }
  .pf2-filters-toggle[aria-expanded="true"] { border-color:var(--pe-accent);color:var(--pe-accent); }

  .pf2-layout { display:block; }
  .pf2-sidebar { display:none; }
  .pf2-sidebar.open { display:block;margin-bottom:20px; }
  .pf2-sidebar-inner { padding:20px;display:flex;flex-direction:column;gap:18px; }
  .pf2-sidebar-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pf2-panel-close-btn { width:100%; }

  .pf2-filter-group { display:flex;flex-direction:column;gap:10px; }
  .pf2-fieldset { border:none;padding:0;margin:0; }
  .pf2-filter-label { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.4px; }
  .pf2-pill-row { display:flex;flex-wrap:wrap;gap:8px; }

  .pf2-pill { position:relative;display:inline-flex;align-items:center;padding:8px 15px;min-height:40px;border-radius:999px;border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .pf2-pill input { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
  .pf2-pill:has(input:checked) { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }
  .pf2-pill:has(input:focus-visible) { outline:2px solid var(--pe-accent);outline-offset:2px; }

  .pf2-sidebar-actions { display:flex;flex-direction:column;gap:8px;padding-top:4px;border-top:1px solid var(--pe-border); }
  .pf2-reset-btn, .pf2-clear-btn { padding:9px 4px;border:none;background:none;font:var(--pe-text-small);font-weight:600;cursor:pointer;text-align:left;min-height:40px; }
  .pf2-reset-btn { color:var(--pe-accent); }
  .pf2-clear-btn { color:var(--pe-text-muted); }
  .pf2-reset-btn:hover, .pf2-clear-btn:hover { text-decoration:underline; }

  .pf2-chips { display:flex;flex-wrap:nowrap;gap:8px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px; }
  .pf2-chip { flex-shrink:0;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;min-height:36px;border-radius:999px;border:none;background:var(--pe-sand);color:var(--pe-accent);font:var(--pe-text-small);font-weight:600;cursor:pointer;white-space:nowrap; }
  .pf2-chip:hover { background:var(--pe-border-strong); }

  .pf2-result-count { font:var(--pe-text-small);color:var(--pe-text-muted);margin-bottom:14px; }

  .pf2-loading { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 24px;text-align:center; }
  .pf2-spinner { width:48px;height:48px;border-radius:50%;border:3px solid var(--pe-sand);border-top-color:var(--pe-accent);animation:pf2-spin .85s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .pf2-spinner { animation:none; } }
  @keyframes pf2-spin { to { transform:rotate(360deg); } }
  .pf2-loading-title { font:var(--pe-text-h3);color:var(--pe-text); }

  .pf2-error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:var(--pe-radius-md);padding:14px 16px;color:var(--pe-terracotta,#8b3a1e);font:var(--pe-text-body); }

  .pf2-empty-card { padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
  .pf2-empty-card svg { color:var(--pe-sage-400); }
  .pf2-empty-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pf2-empty-sub { max-width:380px; }

  .pf2-grid { display:grid;grid-template-columns:1fr;gap:16px; }

  .pf2-card { position:relative;display:flex;gap:14px;align-items:center;padding:14px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);box-shadow:var(--pe-shadow-sm);text-decoration:none;color:inherit;transition:box-shadow .15s,border-color .15s; }
  .pf2-card:hover { box-shadow:var(--pe-shadow-md);border-color:var(--pe-border-strong); }
  .pf2-card:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .pf2-card-photo { flex-shrink:0;width:64px;height:64px;border-radius:var(--pe-radius-sm);background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }
  .pf2-card-body { flex:1;min-width:0; }
  .pf2-card-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px; }
  .pf2-card-name { font:var(--pe-text-h3);color:var(--pe-text); }
  .pf2-card-latin { margin-top:2px;font-style:italic;font-size:13px;color:var(--pe-text-muted); }
  .pf2-badge { flex-shrink:0;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;white-space:nowrap; }
  .pf2-badge-species { background:var(--pe-sand);color:var(--pe-accent); }
  .pf2-badge-cultivar { background:#fdf3e0;color:#8a6a1e; }
  .pf2-card-meta { margin-top:8px;display:flex;flex-wrap:wrap;gap:6px; }
  .pf2-card-tag { display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;background:var(--pe-sand);color:var(--pe-text-muted);font-size:11.5px;font-weight:600; }
  .pf2-card-chevron { flex-shrink:0;color:var(--pe-text-muted); }

  @media (min-width:640px) {
    .pf2-grid { grid-template-columns:repeat(2,1fr); }
  }

  @media (min-width:1024px) {
    .pf2-filters-toggle { display:none; }
    .pf2-panel-close-btn { display:none; }
    .pf2-layout { display:grid;grid-template-columns:270px 1fr;gap:28px;align-items:start; }
    .pf2-sidebar { display:block !important;position:sticky;top:24px; }
    .pf2-grid { grid-template-columns:repeat(3,1fr); }
  }
`;
