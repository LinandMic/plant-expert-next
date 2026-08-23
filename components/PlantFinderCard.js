import { formatHeightRange, sunLabels, entryTypeLabel, plantTypeLabel } from "@/lib/plantFinderFormat";

// returnTo: an optional already-serialized query string (q=...&type=...)
// carrying the list page's current search/filter state, so the detail
// page's "Retour à la recherche" link can round-trip back to it. Purely
// additive to the URL — never required for the card link to work.
export default function PlantFinderCard({ plant, returnTo }) {
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const sun = sunLabels(plant.sun);
  const badgeLabel = entryTypeLabel(plant.entryType);
  const plantType = plantTypeLabel(plant.plantType);
  const href = `/plant-finder/${encodeURIComponent(plant.slug)}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;

  return (
    <a href={href} className="pf-card">
      <div className="pf-card-top">
        <div className="pf-card-name">{plant.displayName}</div>
        {badgeLabel && (
          <span className={"pf-badge " + (plant.entryType === "cultivar" ? "pf-badge-cultivar" : "pf-badge-species")}>
            {badgeLabel}
          </span>
        )}
      </div>
      {plant.commonName && <div className="pf-card-common">{plant.commonName}</div>}
      <div className="pf-card-meta">
        {plantType && <span className="pf-card-tag">{plantType}</span>}
        {height && <span className="pf-card-tag">📏 {height}</span>}
        {sun && <span className="pf-card-tag">☀️ {sun.join(", ")}</span>}
      </div>
    </a>
  );
}
