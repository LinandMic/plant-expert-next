import { useEffect, useState } from "react";
import { fetchCatalogPlantById } from "@/lib/plantFinderApi";
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
import { IconSprig, IconTrash, IconAlertCircle, IconCheck, IconMapPin } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n";

// The catalog-aware counterpart to PlanteFiche (pages/index.js), used only
// when a My Garden plant has source='catalog' (see this round's audit —
// PlanteFiche's entire content is built around ai_data.identite/maladies/
// taille/nutriments/arrosage/calendrier, none of which a catalog-sourced
// plant ever has, which is why it rendered almost empty). Reuses the SAME
// pure, already-tested formatting helpers Plant Finder's own detail page
// uses (lib/plantFinderFormat.js) plus a byte-for-byte twin of its fetch
// (lib/plantFinderApi.js's fetchCatalogPlantById, looked up by
// catalog_plant_id instead of slug) — never duplicating that logic, only
// the small amount of presentational JSX/CSS that legitimately differs
// (garden zone chip + "in my garden"/remove action instead of a search
// back-link + "add to garden" CTA).
//
// No AI-specific tabs are ever rendered here — never faked disease/
// pruning/nutrition/watering/calendar content, per this round's explicit
// rule.
// fetchCatalogPlant is injectable (defaults to the real
// lib/plantFinderApi.js fetch) — same dependency-injection convention
// lib/plantFinderApi.js's own searchPublishedPlants already uses, so this
// component can be exercised with fixture data in isolation, without a
// live Supabase session.
export default function CatalogPlantGardenDetail({ plant, zones, onRemove, deleteError, fetchCatalogPlant = fetchCatalogPlantById }) {
  const { t, locale } = useI18n();
  const [catalogPlant, setCatalogPlant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCatalogPlant(plant.catalogPlantId)
      .then((data) => {
        if (!cancelled) {
          setCatalogPlant(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogPlant(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plant.catalogPlantId]);

  // Fallback when the live fetch is still pending, failed, or the catalog
  // entry has since been unpublished/removed: the garden plant's own
  // add-time snapshot (never a second query, never invented) — enough to
  // show a name and scientific name, never a blank page. Real catalog
  // traits (height/spread/exposure/evergreen/...) simply aren't shown in
  // that case, same "hide rather than show empty" rule as the AI tabs.
  const effective = catalogPlant || {
    displayName: plant.latinName,
    preferredCommonNameFr: plant.preferredCommonNameFr,
    preferredCommonNameEn: plant.preferredCommonNameEn,
    entryType: null,
    imageUrl: null,
    imageAlt: null,
    taxon: plant.family ? { family: plant.family, genus: null } : null,
  };

  const { title, scientificSubtitle } = plantFinderDisplayTitle(effective, locale);
  const badgeLabel = entryTypeLabel(effective.entryType, t);
  const zoneName = zones ? zoneNameForPlantId(plant.zoneId, zones) : null;

  const height = catalogPlant ? formatHeightRange(catalogPlant.heightMinCm, catalogPlant.heightMaxCm) : null;
  const spread = catalogPlant ? formatHeightRange(null, catalogPlant.spreadMaxCm) : null;
  const sun = catalogPlant ? sunLabels(catalogPlant.sun, t) : null;
  const exposureValue = sun ? sun.join(", ") : null;
  const plantType = catalogPlant ? plantTypeLabel(catalogPlant.plantType, t) : null;
  const hasAnyStat = [height, spread, exposureValue, plantType].some(Boolean);
  const glance = catalogPlant ? formatPlantGlance(catalogPlant, t, locale) : null;

  const detailRows = catalogPlant
    ? [
        { key: "genus", label: t("finder.genus"), value: catalogPlant.taxon?.genus },
        { key: "evergreen", label: t("finder.evergreen"), value: formatBoolean(catalogPlant.evergreen, t) },
        { key: "waterNeed", label: t("finder.waterNeed"), value: catalogPlant.waterNeed },
        { key: "container", label: t("finder.containerGrowing"), value: formatBoolean(catalogPlant.containerSuitable, t) },
        { key: "edible", label: t("finder.edible"), value: formatBoolean(catalogPlant.edible, t) },
        { key: "flowering", label: t("finder.flowering"), value: formatFloweringMonths(catalogPlant.floweringMonths, t) },
      ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "")
    : [];

  return (
    <div className="mjc-page">
      <style>{CATALOG_DETAIL_STYLES}</style>

      <div className="mjc-hero">
        {effective.imageUrl ? (
          <div className="mjc-hero-media">
            <img src={effective.imageUrl} alt={effective.imageAlt || title} className="mjc-hero-image" />
          </div>
        ) : (
          <div className="mjc-hero-photo-placeholder">
            <IconSprig size={36} />
          </div>
        )}
        <div className="mjc-hero-body">
          <div className="mjc-hero-top">
            <h1 className="mjc-hero-name">{title}</h1>
            {badgeLabel && <span className="mjc-badge">{badgeLabel}</span>}
          </div>
          {scientificSubtitle && <div className="mjc-hero-latin">{scientificSubtitle}</div>}
          <div className="mjc-hero-facts">
            {effective.taxon?.family && <span className="mjc-fact-pill">{effective.taxon.family}</span>}
            {zoneName && (
              <span className="mjc-fact-pill mjc-fact-pill-zone">
                <IconMapPin size={12} /> {zoneName}
              </span>
            )}
          </div>
          <span className="mjc-saved-badge">
            <IconCheck size={15} /> {t("finder.inMyGarden")}
          </span>
        </div>
      </div>

      {hasAnyStat && (
        <div className="mjc-stats-grid">
          <StatTile label={t("finder.height")} value={height} />
          <StatTile label={t("finder.width")} value={spread} />
          <StatTile label={t("finder.exposure")} value={exposureValue} />
          <StatTile label={t("finder.type")} value={plantType} />
        </div>
      )}

      {glance && (
        <div className="mjc-glance">
          <div className="mjc-glance-title">{t("finder.atAGlance")}</div>
          <p className="mjc-glance-text">{glance}</p>
        </div>
      )}

      {detailRows.length > 0 && (
        <>
          <h2 className="mjc-section-title">{t("finder.characteristics")}</h2>
          <div className="mjc-detail-list">
            {detailRows.map((row) => (
              <DetailRow key={row.key} label={row.label} value={row.value} />
            ))}
          </div>
        </>
      )}

      {loading && <div className="mjc-loading-hint">{t("common.loadingEllipsis")}</div>}

      {deleteError && (
        <div className="error-box mjc-error">
          <IconAlertCircle size={14} /> {deleteError}
        </div>
      )}
      <div className="mjc-remove-row">
        <button type="button" className="mjc-remove-btn" onClick={onRemove}>
          <IconTrash size={15} /> {t("garden.removeFromGarden")}
        </button>
      </div>
    </div>
  );
}

function zoneNameForPlantId(zoneId, zonesList) {
  if (!zoneId) return null;
  const zone = (zonesList || []).find((z) => z.id === zoneId);
  return zone ? zone.name : null;
}

function StatTile({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="mjc-stat-tile">
      <div className="mjc-stat-label">{label}</div>
      <div className="mjc-stat-value">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="mjc-detail-row">
      <span className="mjc-detail-label">{label}</span>
      <span className="mjc-detail-value">{value}</span>
    </div>
  );
}

const CATALOG_DETAIL_STYLES = `
  .mjc-page { max-width:640px;margin:0 auto; }

  .mjc-hero { border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm);margin-bottom:20px;overflow:hidden; }
  .mjc-hero-media { line-height:0; }
  .mjc-hero-image { display:block;width:100%;aspect-ratio:4/3;object-fit:cover; }
  .mjc-hero-photo-placeholder { width:100%;aspect-ratio:4/3;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }
  .mjc-hero-body { padding:16px 20px 20px; }
  .mjc-hero-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap; }
  .mjc-hero-name { font-family:var(--pe-font-display);font-weight:600;font-size:clamp(22px,3vw,30px);color:var(--pe-text);line-height:1.15; }
  .mjc-badge { flex-shrink:0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;white-space:nowrap;margin-top:2px;background:var(--pe-sand);color:var(--pe-accent); }
  .mjc-hero-latin { font-style:italic;color:var(--pe-text-muted);font-size:15px;margin-top:6px; }
  .mjc-hero-facts { display:flex;flex-wrap:wrap;gap:6px;margin-top:10px; }
  .mjc-fact-pill { display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:var(--pe-sand);color:var(--pe-text-muted);font-size:11.5px;font-weight:600; }
  .mjc-fact-pill-zone { background:var(--pe-sage-400);color:var(--pe-forest-950); }
  .mjc-saved-badge { display:inline-flex;align-items:center;gap:6px;margin-top:12px;color:var(--pe-accent);font-size:13.5px;font-weight:600; }
  @media (max-width:480px) { .mjc-hero-body { padding:14px 16px 18px; } }

  .mjc-stats-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px; }
  .mjc-stat-tile { background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-md);padding:12px 14px; }
  .mjc-stat-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:4px; }
  .mjc-stat-value { font-family:var(--pe-font-display);font-weight:600;font-size:17px;color:var(--pe-text);line-height:1.25; }

  .mjc-glance { background:var(--pe-sand);border-radius:var(--pe-radius-md);padding:14px 16px;margin-bottom:22px; }
  .mjc-glance-title { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:5px; }
  .mjc-glance-text { font:var(--pe-text-body);font-size:14px;color:var(--pe-text);line-height:1.5;margin:0; }

  .mjc-section-title { font-family:var(--pe-font-display);font-weight:600;font-size:19px;color:var(--pe-text);margin-bottom:10px; }
  .mjc-detail-list { background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-md);overflow:hidden; }
  .mjc-detail-row { display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:11px 16px;border-bottom:1px solid var(--pe-border); }
  .mjc-detail-row:last-child { border-bottom:none; }
  .mjc-detail-label { font-size:13px;color:var(--pe-text-muted);font-weight:500;flex-shrink:0; }
  .mjc-detail-value { font-size:14px;color:var(--pe-text);font-weight:500;text-align:right; }

  .mjc-loading-hint { color:var(--pe-text-muted);font-size:13px;margin-bottom:16px; }
  .mjc-error { margin-bottom:16px; }
  .mjc-remove-row { margin-top:8px; }
  .mjc-remove-btn { display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:10px 16px;border-radius:var(--pe-radius-sm);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer; }
  .mjc-remove-btn:hover { border-color:var(--pe-terracotta,#8b3a1e);color:var(--pe-terracotta,#8b3a1e); }
`;
