import { formatHeightRange, sunLabels, entryTypeLabel } from "@/lib/plantFinderFormat";

export default function PlantFinderCard({ plant }) {
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const sun = sunLabels(plant.sun);
  const badgeLabel = entryTypeLabel(plant.entryType);

  return (
    <a href={`/plant-finder/${encodeURIComponent(plant.slug)}`} className="pf-card">
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
        {plant.plantType && <span className="pf-card-tag">{plant.plantType}</span>}
        {height && <span className="pf-card-tag">📏 {height}</span>}
        {sun && <span className="pf-card-tag">☀️ {sun.join(", ")}</span>}
      </div>
    </a>
  );
}
