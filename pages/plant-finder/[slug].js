import { useEffect, useState } from "react";
import AppShell from "@/components/ui/AppShell";
import Card from "@/components/ui/Card";
import { useRouter } from "next/router";
import { fetchPublishedPlantBySlug } from "@/lib/plantFinderApi";
import {
  formatHeightRange,
  sunLabels,
  entryTypeLabel,
  formatBoolean,
  formatFloweringMonths,
  formatPlantGlance,
  plantTypeLabel,
  plantFinderDisplayTitle,
} from "@/lib/plantFinderFormat";
import { IconSprig, IconCheck } from "@/components/ui/icons";
import { getExternalNavItems } from "@/components/ui/externalNavItems";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/useAuth";
import { useGardenZones } from "@/lib/useGardenZones";
import AuthModal from "@/components/AuthModal";
import AddToGardenModal from "@/components/AddToGardenModal";
import Button from "@/components/ui/Button";

// Client-fetched on purpose (not getServerSideProps): this route ships in
// the native (Capacitor) static export, and Next's static export cannot
// include a page that uses getServerSideProps. Same query
// (fetchPublishedPlantBySlug), same anon/RLS-scoped Supabase client, no
// service_role, no separate admin path — only WHEN it runs changed. The
// not-found-vs-error split is preserved: a missing slug or a draft row RLS
// already hides both resolve to `plant: null` with no distinguishing signal
// (spec §9 — a draft is never revealed to exist), while a real fetch
// failure sets a separate error flag instead of being silently treated as
// "not found". One inherent behavior change from the old GSSP version: the
// response is always HTTP 200 (a static file) with the "not found" state
// rendered client-side, rather than a real HTTP 404 — unavoidable on a
// static host, not a redesign choice.
function usePlantFinderDetail(slug, ready) {
  const [plant, setPlant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!slug) {
      setPlant(null);
      setLoadError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    fetchPublishedPlantBySlug(slug)
      .then((data) => {
        if (cancelled) return;
        setPlant(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPlant(null);
        setLoadError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, ready]);

  return { plant, loading, loadError };
}

// StatTile: one of the 4 compact "key stats" immediately below the hero.
// Hides itself entirely when its value is missing (spec: never show
// "N/A") — the 2x2 grid simply has fewer tiles rather than an empty one.
function StatTile({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="pfd-stat-tile">
      <div className="pfd-stat-label">{label}</div>
      <div className="pfd-stat-value">{value}</div>
    </div>
  );
}

// DetailRow: one row of the grouped secondary-traits list (label left,
// value right). The caller (detailRows below) already filters out missing
// values before rendering, so this component itself needs no null guard.
function DetailRow({ label, value }) {
  return (
    <div className="pfd-detail-row">
      <span className="pfd-detail-label">{label}</span>
      <span className="pfd-detail-value">{value}</span>
    </div>
  );
}

export default function PlantFinderDetailPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const auth = useAuth();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const { plant, loading, loadError } = usePlantFinderDetail(slug, router.isReady);
  const { zones, loading: zonesLoading } = useGardenZones(auth.user, auth.loading);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // Session-local only: flips the CTA to a confirmed state right after a
  // successful add on THIS view, never a persistent "already in your
  // garden" check (that would need an extra query on every page load — see
  // round report). A fresh visit later shows "Ajouter à mon jardin" again,
  // which is fine: duplicates are allowed by design (no uniqueness
  // constraint on plants for this), this only guards the one interaction.
  const [addedToGarden, setAddedToGarden] = useState(false);

  // "Do not silently fail" (spec): while auth is still resolving, the CTA
  // stays disabled rather than risking a wrong logged-out/logged-in branch
  // on a stray click. Once resolved, no session -> open the EXISTING
  // AuthModal (no new auth architecture); a real session -> open the
  // add-to-garden flow.
  const handleAddToGardenClick = () => {
    if (auth.loading) return;
    if (!auth.user) {
      setShowAuthModal(true);
      return;
    }
    setShowAddModal(true);
  };
  // `from` is the list page's own serialized filter/search query string,
  // passed through by PlantFinderCard so this link returns the visitor to
  // their exact prior search state rather than always resetting it.
  const from = typeof router.query.from === "string" ? router.query.from : "";
  const backHref = from ? `/plant-finder?${from}` : "/plant-finder";
  // Prefer router.back() only when it's safe to assume the previous history
  // entry really is that exact Plant Finder search: `from` is set only by
  // PlantFinderCard's own link (never typed/shared), so its presence is
  // itself the safety signal — no new navigation architecture, no guessing
  // at arbitrary history state. router.back() then restores scroll position
  // and any in-page state the list still had, which a fresh href load
  // would not. Without `from` (direct link, shared URL, no known prior
  // state) the plain href to /plant-finder below is left to do its normal
  // job — never blocked, never intercepted.
  const handleBackClick = (event) => {
    if (from && typeof window !== "undefined" && window.history.length > 1) {
      event.preventDefault();
      router.back();
    }
  };

  if (loading) {
    return (
      <AppShell navItems={getExternalNavItems(t)} activeKey="trouver">
        <div className="pfd-page">
          <style>{DETAIL_STYLES}</style>
          <div className="pfd-loading" role="status" aria-live="polite">
            <div className="pfd-spinner" aria-hidden="true" />
            <div className="pfd-loading-title">{t("finder.loadingPlant")}</div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell navItems={getExternalNavItems(t)} activeKey="trouver">
        <div className="pfd-page">
          <style>{DETAIL_STYLES}</style>
          <a href={backHref} className="pfd-back-link" onClick={handleBackClick}>{t("finder.backLink")}</a>
          <div className="pfd-error-box">{t("finder.detailLoadError")}</div>
        </div>
      </AppShell>
    );
  }

  if (!plant) {
    return (
      <AppShell navItems={getExternalNavItems(t)} activeKey="trouver">
        <div className="pfd-page">
          <style>{DETAIL_STYLES}</style>
          <Card className="pfd-empty-card">
            <IconSprig size={26} />
            <div className="pfd-empty-title">{t("finder.detailNotFound")}</div>
            <a href="/plant-finder" className="pfd-empty-back">{t("finder.backLink")}</a>
          </Card>
        </div>
      </AppShell>
    );
  }

  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const spread = formatHeightRange(null, plant.spreadMaxCm);
  const sun = sunLabels(plant.sun, t);
  const plantType = plantTypeLabel(plant.plantType, t);
  const badgeLabel = entryTypeLabel(plant.entryType, t);
  const evergreenLabel = formatBoolean(plant.evergreen, t);
  const containerLabel = formatBoolean(plant.containerSuitable, t);
  const edibleLabel = formatBoolean(plant.edible, t);
  const flowering = formatFloweringMonths(plant.floweringMonths, t);
  const exposureValue = sun ? sun.join(", ") : null;
  // Same preferred-common-name-leads / displayName-as-scientific-subtitle
  // convention as PlantFinderCard, kept consistent across list -> detail
  // (spec §12), now locale-aware (plant_common_names, not plant_catalog.common_name).
  const { title, scientificSubtitle } = plantFinderDisplayTitle(plant, locale);

  // The 4 key stats (spec: height, spread, exposure, plant type) promoted
  // above the fold — each hides itself individually when absent, and the
  // whole grid is skipped only if every one of them is.
  const hasAnyStat = [height, spread, exposureValue, plantType].some(Boolean);

  // "At a glance" — one deterministic line built only from existing
  // structured fields (lib/plantFinderFormat.js's formatPlantGlance); null
  // when nothing is available, so the block itself is skipped rather than
  // rendered empty.
  const glance = formatPlantGlance(plant, t, locale);

  // Secondary traits, consolidated into a calmer label/value list. height,
  // spread, exposure and plant type are NOT repeated here — they already
  // lead as the key stats above; this list is what used to fill out the
  // rest of the old repeated-card grid. Genus is kept ("botanical genus if
  // still useful" — it still is, e.g. distinguishing Acer from its
  // species). Pre-filtered here (rather than inside DetailRow) so the
  // section heading itself can be skipped when every row would be empty.
  const detailRows = [
    { key: "genus", label: t("finder.genus"), value: plant.taxon?.genus },
    { key: "evergreen", label: t("finder.evergreen"), value: evergreenLabel },
    { key: "waterNeed", label: t("finder.waterNeed"), value: plant.waterNeed },
    { key: "container", label: t("finder.containerGrowing"), value: containerLabel },
    { key: "edible", label: t("finder.edible"), value: edibleLabel },
    { key: "flowering", label: t("finder.flowering"), value: flowering },
  ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "");

  return (
    <AppShell navItems={getExternalNavItems(t)} activeKey="trouver">
      <div className="pfd-page">
        <style>{DETAIL_STYLES}</style>

        <a href={backHref} className="pfd-back-link" onClick={handleBackClick}>{t("finder.backLink")}</a>

        <div className="pfd-hero">
          {plant.imageUrl ? (
            <div className="pfd-hero-media">
              <img src={plant.imageUrl} alt={plant.imageAlt || title} className="pfd-hero-image" />
            </div>
          ) : (
            <div className="pfd-hero-photo-placeholder">
              <IconSprig size={36} />
            </div>
          )}
          {(plant.imageAuthor || plant.imageLicense) && (
            <div className="pfd-hero-attribution">
              {plant.imageSourceUrl ? (
                <a href={plant.imageSourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                  {[plant.imageAuthor, plant.imageLicense].filter(Boolean).join(" — ")}
                </a>
              ) : (
                [plant.imageAuthor, plant.imageLicense].filter(Boolean).join(" — ")
              )}
            </div>
          )}
          <div className="pfd-hero-body">
            <div className="pfd-hero-top">
              <h1 className="pfd-hero-name">{title}</h1>
              {badgeLabel && (
                <span className={"pfd-badge " + (plant.entryType === "cultivar" ? "pfd-badge-cultivar" : "pfd-badge-species")}>
                  {badgeLabel}
                </span>
              )}
            </div>
            {scientificSubtitle && <div className="pfd-hero-latin">{scientificSubtitle}</div>}
            {plant.taxon?.family && <div className="pfd-hero-family">{plant.taxon.family}</div>}
          </div>
        </div>

        <Button
          type="button"
          className="pfd-add-to-garden-btn"
          variant={addedToGarden ? "secondary" : "primary"}
          disabled={auth.loading || addedToGarden}
          onClick={handleAddToGardenClick}
        >
          {addedToGarden ? (
            <>
              <IconCheck size={16} /> {t("finder.inMyGarden")}
            </>
          ) : (
            t("finder.addToGarden")
          )}
        </Button>

        {hasAnyStat && (
          <div className="pfd-stats-grid">
            <StatTile label={t("finder.height")} value={height} />
            <StatTile label={t("finder.width")} value={spread} />
            <StatTile label={t("finder.exposure")} value={exposureValue} />
            <StatTile label={t("finder.type")} value={plantType} />
          </div>
        )}

        {glance && (
          <div className="pfd-glance">
            <div className="pfd-glance-title">{t("finder.atAGlance")}</div>
            <p className="pfd-glance-text">{glance}</p>
          </div>
        )}

        {detailRows.length > 0 && (
          <>
            <h2 className="pfd-section-title">{t("finder.characteristics")}</h2>
            <div className="pfd-detail-list">
              {detailRows.map((row) => (
                <DetailRow key={row.key} label={row.label} value={row.value} />
              ))}
            </div>
          </>
        )}
      </div>

      {showAuthModal && <AuthModal auth={auth} onClose={() => setShowAuthModal(false)} />}
      {showAddModal && (
        <AddToGardenModal
          plant={plant}
          locale={locale}
          user={auth.user}
          zones={zones}
          zonesLoading={zonesLoading}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            setAddedToGarden(true);
          }}
        />
      )}
    </AppShell>
  );
}

const DETAIL_STYLES = `
  /* Real-device (installed PWA / viewport-fit=cover) fix: the hero photo
     and back link used to start right under the iOS status bar, which
     visually sat on top of the image. env(safe-area-inset-top) is 0 in
     every normal browser context (the browser chrome already reserves
     that space there) and only becomes non-zero in standalone/fullscreen
     mode — so this never adds blank space in regular rendering or on
     desktop, and never hardcodes an iPhone-specific pixel value. Additive
     to pe-shell-content's own existing top padding, not a replacement. */
  .pfd-page { max-width:640px;padding-top:env(safe-area-inset-top); }

  .pfd-back-link { display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:2px 0;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;text-decoration:none;margin-bottom:8px; }
  .pfd-back-link:hover { color:var(--pe-accent); }

  /* --- Loading / error / not-found: same visual vocabulary as the Plant
     Finder list page (pages/plant-finder/index.js's pf2-loading/pf2-error-box/
     pf2-empty-card), scoped locally here under the pfd- prefix. ---------- */
  .pfd-loading { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 24px;text-align:center; }
  .pfd-spinner { width:48px;height:48px;border-radius:50%;border:3px solid var(--pe-sand);border-top-color:var(--pe-accent);animation:pfd-spin .85s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .pfd-spinner { animation:none; } }
  @keyframes pfd-spin { to { transform:rotate(360deg); } }
  .pfd-loading-title { font:var(--pe-text-h3);color:var(--pe-text); }

  .pfd-error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:var(--pe-radius-md);padding:14px 16px;color:var(--pe-terracotta,#8b3a1e);font:var(--pe-text-body); }

  .pfd-empty-card { padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
  .pfd-empty-card svg { color:var(--pe-sage-400); }
  .pfd-empty-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pfd-empty-back { color:var(--pe-accent);font:var(--pe-text-small);font-weight:600;text-decoration:none; }
  .pfd-empty-back:hover { text-decoration:underline; }

  /* --- Hero: full-bleed photo, calm text block below, no overlay ------- */
  .pfd-hero { border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm);margin-bottom:20px;overflow:hidden; }
  .pfd-hero-media { line-height:0; }
  .pfd-hero-image { display:block;width:100%;aspect-ratio:4/3;object-fit:cover; }
  .pfd-hero-photo-placeholder { width:100%;aspect-ratio:4/3;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }

  /* Kept below the photo (never an overlay on top of it) — just visually
     lighter than before: smaller, softened, still a real working link. */
  .pfd-hero-attribution { padding:7px 20px 0;font-size:10.5px;color:var(--pe-text-muted);opacity:0.75; }
  .pfd-hero-attribution a { color:inherit;text-decoration:underline; }

  .pfd-hero-body { padding:16px 20px 20px; }
  .pfd-hero-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap; }
  .pfd-hero-name { font-family:var(--pe-font-display);font-weight:600;font-size:clamp(22px,3vw,30px);color:var(--pe-text);line-height:1.15; }
  .pfd-badge { flex-shrink:0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;white-space:nowrap;margin-top:2px; }
  .pfd-badge-species { background:var(--pe-sand);color:var(--pe-accent); }
  .pfd-badge-cultivar { background:#fdf3e0;color:#8a6a1e; }
  .pfd-hero-latin { font-style:italic;color:var(--pe-text-muted);font-size:15px;margin-top:6px; }
  .pfd-hero-family { color:var(--pe-text-muted);font-size:11px;margin-top:8px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600; }
  @media (max-width:480px) { .pfd-hero-body { padding:14px 16px 18px; } .pfd-hero-attribution { padding:6px 16px 0; } }

  /* --- Add to garden CTA: a normal (non-sticky) full-width primary
     button — reuses components/ui/Button's existing .pe-btn styling
     verbatim (forest palette, 44px min-height already built in), only
     stretched to full width here. Deliberately not sticky/fixed: it never
     has to be reconciled against the fixed bottom mobile nav. ---------- */
  .pfd-add-to-garden-btn { width:100%;margin-bottom:18px; }

  /* --- Key stats: compact 2x2, no repeated large beige blocks ---------- */
  .pfd-stats-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px; }
  .pfd-stat-tile { background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-md);padding:12px 14px; }
  .pfd-stat-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:4px; }
  .pfd-stat-value { font-family:var(--pe-font-display);font-weight:600;font-size:17px;color:var(--pe-text);line-height:1.25; }

  /* --- At a glance: one calm synthesis line ----------------------------- */
  .pfd-glance { background:var(--pe-sand);border-radius:var(--pe-radius-md);padding:14px 16px;margin-bottom:22px; }
  .pfd-glance-title { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:5px; }
  .pfd-glance-text { font:var(--pe-text-body);font-size:14px;color:var(--pe-text);line-height:1.5;margin:0; }

  /* --- Secondary traits: grouped list, label left / value right --------- */
  .pfd-section-title { font-family:var(--pe-font-display);font-weight:600;font-size:19px;color:var(--pe-text);margin-bottom:10px; }
  .pfd-detail-list { background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-md);overflow:hidden; }
  .pfd-detail-row { display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:11px 16px;border-bottom:1px solid var(--pe-border); }
  .pfd-detail-row:last-child { border-bottom:none; }
  .pfd-detail-label { font-size:13px;color:var(--pe-text-muted);font-weight:500;flex-shrink:0; }
  .pfd-detail-value { font-size:14px;color:var(--pe-text);font-weight:500;text-align:right; }
`;
