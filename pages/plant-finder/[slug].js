import AppShell from "@/components/ui/AppShell";
import { useRouter } from "next/router";
import { fetchPublishedPlantBySlug } from "@/lib/plantFinderApi";
import { formatHeightRange, sunLabels, entryTypeLabel, formatBoolean, formatFloweringMonths, plantTypeLabel, plantFinderDisplayTitle } from "@/lib/plantFinderFormat";
import { IconHome, IconCamera, IconSprout, IconSearch, IconUser, IconSprig } from "@/components/ui/icons";

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

// Same standalone-route navItems as pages/plant-finder/index.js — see that
// file's comment for why Accueil/Identifier/Mon jardin all point at "/".
const NAV_ITEMS = [
  { key: "accueil", label: "Accueil", icon: IconHome, kind: "link", href: "/", placement: "main" },
  { key: "identifier", label: "Identifier", icon: IconCamera, kind: "link", href: "/", placement: "main", emphasis: true },
  { key: "jardin", label: "Mon jardin", icon: IconSprout, kind: "link", href: "/", placement: "main" },
  { key: "trouver", label: "Trouver", icon: IconSearch, kind: "link", href: "/plant-finder", placement: "main" },
  { key: "profil", label: "Profil", icon: IconUser, kind: "link", href: "/profile", placement: "bottom" },
];

function Field({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="pfd-info-card">
      <div className="pfd-info-label">{label}</div>
      <div className="pfd-info-value">{value}</div>
    </div>
  );
}

// CoreField — for the grid's main physical/environmental characteristics
// only (Type, Hauteur, Largeur, Exposition). Unlike Field, a genuinely
// unknown value is still shown as its own row, labeled "Non renseigné" —
// this is presentation only: the underlying value stays null, nothing is
// inferred, borrowed from a parent taxon, or read from a raw provider
// value. Keeping this to the core set (not every optional attribute) is
// what keeps the sheet compact (spec: "garde une fiche compacte").
function CoreField({ label, value }) {
  const display = value === null || value === undefined || value === "" ? "Non renseigné" : value;
  return (
    <div className="pfd-info-card">
      <div className="pfd-info-label">{label}</div>
      <div className="pfd-info-value">{display}</div>
    </div>
  );
}

export default function PlantFinderDetailPage({ plant }) {
  const router = useRouter();
  // `from` is the list page's own serialized filter/search query string,
  // passed through by PlantFinderCard so this link returns the visitor to
  // their exact prior search state rather than always resetting it.
  const from = typeof router.query.from === "string" ? router.query.from : "";
  const backHref = from ? `/plant-finder?${from}` : "/plant-finder";
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const spread = formatHeightRange(null, plant.spreadMaxCm);
  const sun = sunLabels(plant.sun);
  const plantType = plantTypeLabel(plant.plantType);
  const badgeLabel = entryTypeLabel(plant.entryType);
  const evergreenLabel = formatBoolean(plant.evergreen);
  const containerLabel = formatBoolean(plant.containerSuitable);
  const edibleLabel = formatBoolean(plant.edible);
  const flowering = formatFloweringMonths(plant.floweringMonths);
  // Same commonName-leads / displayName-as-scientific-subtitle convention as
  // PlantFinderCard, kept consistent across list -> detail (spec §12).
  const { title, scientificSubtitle } = plantFinderDisplayTitle(plant);

  return (
    <AppShell navItems={NAV_ITEMS} activeKey="trouver">
      <div className="pfd-page">
        <style>{DETAIL_STYLES}</style>

        <a href={backHref} className="pfd-back-link">← Retour à la recherche</a>

        <div className="pfd-hero">
          <div className="pfd-hero-photo">
            <IconSprig size={40} />
          </div>
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

        <h2 className="pfd-section-title">Caractéristiques</h2>
        <div className="pfd-info-grid">
          <CoreField label="Type" value={plantType} />
          <Field label="Genre botanique" value={plant.taxon?.genus} />
          <CoreField label="Hauteur" value={height} />
          <CoreField label="Largeur" value={spread} />
          <CoreField label="Exposition" value={sun ? sun.join(", ") : null} />
          <Field label="Feuillage persistant" value={evergreenLabel} />
          <Field label="Besoin en eau" value={plant.waterNeed} />
          <Field label="Culture en pot" value={containerLabel} />
          <Field label="Comestible" value={edibleLabel} />
          <Field label="Floraison" value={flowering} />
        </div>
      </div>
    </AppShell>
  );
}

const DETAIL_STYLES = `
  .pfd-page { max-width:760px; }
  .pfd-back-link { display:inline-flex;align-items:center;gap:6px;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;text-decoration:none;margin-bottom:20px; }
  .pfd-back-link:hover { color:var(--pe-accent); }

  .pfd-hero { display:flex;gap:20px;align-items:flex-start;padding:24px;border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm);margin-bottom:28px; }
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
  @media (max-width:480px) { .pfd-hero { padding:18px;gap:14px; } .pfd-hero-photo { width:64px;height:64px; } }

  .pfd-section-title { font-family:var(--pe-font-display);font-weight:600;font-size:20px;color:var(--pe-text);margin-bottom:14px; }
  .pfd-info-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
  .pfd-info-card { background:var(--pe-sand);border-radius:var(--pe-radius-sm);padding:13px 14px; }
  .pfd-info-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.7px;color:var(--pe-text-muted);font-weight:700;margin-bottom:3px; }
  .pfd-info-value { font:var(--pe-text-body);font-size:14px;color:var(--pe-text);font-weight:500;line-height:1.4; }
  @media (max-width:480px) { .pfd-info-grid { grid-template-columns:1fr; } }
`;
