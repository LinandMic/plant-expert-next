import AppShell from "@/components/ui/AppShell";
import { useRouter } from "next/router";
import { fetchPublishedPlantBySlug } from "@/lib/plantFinderApi";
import { formatHeightRange, sunLabels, entryTypeLabel, formatBoolean, formatFloweringMonths, plantTypeLabel, plantFinderDisplayTitle } from "@/lib/plantFinderFormat";
import { IconSprig } from "@/components/ui/icons";
import { getExternalNavItems } from "@/components/ui/externalNavItems";
import { useI18n } from "@/lib/i18n";

// Server-rendered on purpose: returning `notFound: true` is what gives a
// missing slug (or a draft row RLS already hides) Next.js's real 404
// behavior (spec §9) — the public visitor sees the exact same 404 as any
// unknown URL, never a hint that a draft row exists at this slug. Uses the
// same anon/RLS-scoped Supabase client as the rest of the app; no
// service_role, no separate admin path.
export async function getServerSideProps({ params }) {
  let plant;
  try {
    plant = await fetchPublishedPlantBySlug(params.slug);
  } catch {
    // A real fetch failure (not "not found") — let Next.js's own error
    // page handle it rather than silently reporting a false 404.
    throw new Error("plant-finder: failed to load plant");
  }

  if (!plant) {
    return { notFound: true };
  }

  return { props: { plant } };
}

function Field({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="pfd-info-card">
      <div className="pfd-info-label">{label}</div>
      <div className="pfd-info-value">{value}</div>
    </div>
  );
}

export default function PlantFinderDetailPage({ plant }) {
  const router = useRouter();
  const { t } = useI18n();
  // `from` is the list page's own serialized filter/search query string,
  // passed through by PlantFinderCard so this link returns the visitor to
  // their exact prior search state rather than always resetting it.
  const from = typeof router.query.from === "string" ? router.query.from : "";
  const backHref = from ? `/plant-finder?${from}` : "/plant-finder";
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const spread = formatHeightRange(null, plant.spreadMaxCm);
  const sun = sunLabels(plant.sun, t);
  const plantType = plantTypeLabel(plant.plantType, t);
  const badgeLabel = entryTypeLabel(plant.entryType, t);
  const evergreenLabel = formatBoolean(plant.evergreen, t);
  const containerLabel = formatBoolean(plant.containerSuitable, t);
  const edibleLabel = formatBoolean(plant.edible, t);
  const flowering = formatFloweringMonths(plant.floweringMonths, t);
  // Same commonName-leads / displayName-as-scientific-subtitle convention as
  // PlantFinderCard, kept consistent across list -> detail (spec §12).
  const { title, scientificSubtitle } = plantFinderDisplayTitle(plant);

  return (
    <AppShell navItems={getExternalNavItems(t)} activeKey="trouver">
      <div className="pfd-page">
        <style>{DETAIL_STYLES}</style>

        <a href={backHref} className="pfd-back-link">{t("finder.backLink")}</a>

        <div className="pfd-hero">
          {plant.imageUrl && (
            <div className="pfd-hero-media">
              <img src={plant.imageUrl} alt={plant.imageAlt || title} className="pfd-hero-image" />
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
            </div>
          )}
          <div className="pfd-hero-top-row">
            {!plant.imageUrl && (
              <div className="pfd-hero-photo">
                <IconSprig size={40} />
              </div>
            )}
            <div className="pfd-hero-text">
              <div className="pfd-hero-top">
                <h1 className="pfd-hero-name">{title}</h1>
                {badgeLabel && (
                  <span className={"pfd-badge " + (plant.entryType === "cultivar" ? "pfd-badge-cultivar" : "pfd-badge-species")}>
                    {badgeLabel}
                  </span>
                )}
              </div>
              {scientificSubtitle && <div className="pfd-hero-latin">{scientificSubtitle}</div>}
              {plant.taxon?.canonicalName && plant.taxon.canonicalName !== plant.displayName && (
                <div className="pfd-hero-canonical">{plant.taxon.canonicalName}</div>
              )}
              {plant.taxon?.family && <div className="pfd-hero-family">{plant.taxon.family}</div>}
            </div>
          </div>
        </div>

        <h2 className="pfd-section-title">{t("finder.characteristics")}</h2>
        <div className="pfd-info-grid">
          <Field label={t("finder.type")} value={plantType} />
          <Field label={t("finder.genus")} value={plant.taxon?.genus} />
          <Field label={t("finder.height")} value={height} />
          <Field label={t("finder.width")} value={spread} />
          <Field label={t("finder.exposure")} value={sun ? sun.join(", ") : null} />
          <Field label={t("finder.evergreen")} value={evergreenLabel} />
          <Field label={t("finder.waterNeed")} value={plant.waterNeed} />
          <Field label={t("finder.containerGrowing")} value={containerLabel} />
          <Field label={t("finder.edible")} value={edibleLabel} />
          <Field label={t("finder.flowering")} value={flowering} />
        </div>
      </div>
    </AppShell>
  );
}

const DETAIL_STYLES = `
  .pfd-page { max-width:760px; }
  .pfd-back-link { display:inline-flex;align-items:center;gap:6px;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;text-decoration:none;margin-bottom:20px; }
  .pfd-back-link:hover { color:var(--pe-accent); }

  .pfd-hero { padding:24px;border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm);margin-bottom:28px; }
  .pfd-hero-top-row { display:flex;gap:20px;align-items:flex-start; }
  .pfd-hero-photo { flex-shrink:0;width:88px;height:88px;border-radius:var(--pe-radius-md);background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }
  .pfd-hero-text { flex:1;min-width:0; }
  .pfd-hero-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap; }
  .pfd-hero-name { font-family:var(--pe-font-display);font-weight:600;font-size:clamp(22px,3vw,30px);color:var(--pe-text);line-height:1.15; }
  .pfd-badge { flex-shrink:0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;white-space:nowrap; }
  .pfd-badge-species { background:var(--pe-sand);color:var(--pe-accent); }
  .pfd-badge-cultivar { background:#fdf3e0;color:#8a6a1e; }
  .pfd-hero-latin { font-style:italic;color:var(--pe-text-muted);font-size:15px;margin-top:6px; }
  .pfd-hero-canonical { color:var(--pe-text-muted);font-size:13px;margin-top:3px; }
  .pfd-hero-family { color:var(--pe-text-muted);font-size:11px;margin-top:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600; }
  @media (max-width:480px) { .pfd-hero { padding:18px; } .pfd-hero-top-row { gap:14px; } .pfd-hero-photo { width:64px;height:64px; } }

  .pfd-hero-media { margin:-24px -24px 20px; }
  .pfd-hero-image { display:block;width:100%;max-height:360px;object-fit:cover;border-radius:var(--pe-radius-lg) var(--pe-radius-lg) 0 0; }
  .pfd-hero-attribution { padding:8px 24px 0;font-size:11px;color:var(--pe-text-muted); }
  .pfd-hero-attribution a { color:var(--pe-text-muted);text-decoration:underline; }
  @media (max-width:480px) { .pfd-hero-media { margin:-18px -18px 16px; } .pfd-hero-image { aspect-ratio:16/9;max-height:200px;border-radius:var(--pe-radius-md) var(--pe-radius-md) 0 0; } .pfd-hero-attribution { padding:8px 18px 0; } }

  .pfd-section-title { font-family:var(--pe-font-display);font-weight:600;font-size:20px;color:var(--pe-text);margin-bottom:14px; }
  .pfd-info-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
  .pfd-info-card { background:var(--pe-sand);border-radius:var(--pe-radius-sm);padding:13px 14px; }
  .pfd-info-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:3px; }
  .pfd-info-value { font:var(--pe-text-body);font-size:14px;color:var(--pe-text);font-weight:500;line-height:1.4; }
  @media (max-width:480px) { .pfd-info-grid { grid-template-columns:1fr; } }
`;
