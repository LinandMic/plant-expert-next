import { useRouter } from "next/router";
import { fetchPublishedPlantBySlug } from "@/lib/plantFinderApi";
import { formatHeightRange, sunLabels, entryTypeLabel, formatBoolean, formatFloweringMonths, plantTypeLabel } from "@/lib/plantFinderFormat";

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
    <div className="info-card">
      <div>
        <div className="info-label">{label}</div>
        <div className="info-value">{value}</div>
      </div>
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
    <div className="info-card">
      <div>
        <div className="info-label">{label}</div>
        <div className="info-value">{display}</div>
      </div>
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

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --ink:#0f1f0f;--forest:#1e3a1e;--moss:#3a6b3a;--sage:#7aad7a;--mist:#e8f0e8;--paper:#f4f2ed;--cream:#faf8f3;--gold:#c4962a;--rust:#8b3a1e;--r:14px;--shadow:0 4px 20px rgba(15,31,15,0.1); }
        body { font-family:'Outfit',sans-serif;background:var(--paper);color:var(--ink); }
        .app { min-height:100vh;padding-bottom:40px; }
        .header { background:var(--forest);padding:24px 20px 16px; }
        .header h1 { font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:white; }
        .header h1 em { color:var(--sage);font-style:normal; }
        .header p { color:rgba(255,255,255,0.45);font-size:12px;margin-top:3px; }
        .tab-page { padding:16px 16px 20px;max-width:680px;margin:0 auto; }
        .plant-hero { background:var(--forest);border-radius:var(--r);overflow:hidden;box-shadow:0 8px 32px rgba(15,31,15,0.2);padding:20px 18px; }
        .pf-hero-top { display:flex;align-items:flex-start;justify-content:space-between;gap:10px; }
        .hero-name { font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;color:white;line-height:1.15; }
        .pf-badge { flex-shrink:0;border-radius:20px;padding:4px 11px;font-size:12px;font-weight:600;white-space:nowrap; }
        .pf-badge-species { background:rgba(122,173,122,0.25);color:var(--sage); }
        .pf-badge-cultivar { background:rgba(196,150,42,0.25);color:#f0d890; }
        .hero-latin { font-style:italic;color:rgba(255,255,255,0.6);font-size:14px;margin-top:6px; }
        .hero-family { color:rgba(255,255,255,0.4);font-size:11px;margin-top:3px;text-transform:uppercase;letter-spacing:0.8px; }
        .hero-common { color:rgba(255,255,255,0.7);font-size:14px;margin-top:8px; }
        .section-title { font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--forest);margin:20px 0 12px;font-weight:700; }
        .info-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
        .info-card { background:var(--cream);border-radius:10px;padding:11px; }
        .info-label { font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#999;font-weight:600;margin-bottom:2px; }
        .info-value { font-size:13px;color:var(--ink);font-weight:500;line-height:1.4; }
        .back-btn { display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;padding:0;margin-top:20px;font-weight:500;text-decoration:none; }
        @media(max-width:400px){.info-grid{grid-template-columns:1fr}}
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Botaniste IA · Identification & Mon Jardin</p>
      </div>

      <div className="tab-page">
        <div className="plant-hero">
          <div className="pf-hero-top">
            <h1 className="hero-name">{plant.displayName}</h1>
            {badgeLabel && (
              <span className={"pf-badge " + (plant.entryType === "cultivar" ? "pf-badge-cultivar" : "pf-badge-species")}>
                {badgeLabel}
              </span>
            )}
          </div>
          {plant.taxon?.canonicalName && <div className="hero-latin">{plant.taxon.canonicalName}</div>}
          {plant.taxon?.family && <div className="hero-family">{plant.taxon.family}</div>}
          {plant.commonName && <div className="hero-common">{plant.commonName}</div>}
        </div>

        <h2 className="section-title">Caractéristiques</h2>
        <div className="info-grid">
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

        <a href={backHref} className="back-btn">← Retour à la recherche</a>
      </div>
    </div>
  );
}
