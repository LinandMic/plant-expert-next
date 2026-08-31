import { formatHeightRange, sunLabels, entryTypeLabel, plantTypeLabel, plantFinderDisplayTitle } from "@/lib/plantFinderFormat";
import { IconSprig, IconChevronRight } from "@/components/ui/icons";

// returnTo: an optional already-serialized query string (q=...&type=...)
// carrying the list page's current search/filter state, so the detail
// page's "Retour à la recherche" link can round-trip back to it. Purely
// additive to the URL — never required for the card link to work.
//
// plant_catalog has no image column today (lib/plantFinderApi.js's
// LIST_SELECT) — every card shows the same sober botanical fallback rather
// than a broken image or an invented photo.
//
// display_name is the scientific/cultivar name (always present); common_name
// is the optional French vernacular name. When present, common_name leads as
// the card's title and display_name becomes the italic scientific subtitle —
// when absent, display_name is shown alone as the title.
export default function PlantFinderCard({ plant, returnTo }) {
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const sun = sunLabels(plant.sun);
  const badgeLabel = entryTypeLabel(plant.entryType);
  const plantType = plantTypeLabel(plant.plantType);
  const href = `/plant-finder/${encodeURIComponent(plant.slug)}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;
  const { title, scientificSubtitle } = plantFinderDisplayTitle(plant);

  return (
    <a href={href} className="pf2-card">
      <div className="pf2-card-photo">
        <IconSprig size={26} />
      </div>
      <div className="pf2-card-body">
        <div className="pf2-card-top">
          <div className="pf2-card-name">{title}</div>
          {badgeLabel && (
            <span className={"pf2-badge " + (plant.entryType === "cultivar" ? "pf2-badge-cultivar" : "pf2-badge-species")}>
              {badgeLabel}
            </span>
          )}
        </div>
        {scientificSubtitle && <div className="pf2-card-latin">{scientificSubtitle}</div>}
        <div className="pf2-card-meta">
          {plantType && <span className="pf2-card-tag">{plantType}</span>}
          {height && <span className="pf2-card-tag">{height}</span>}
          {sun && <span className="pf2-card-tag">{sun.join(", ")}</span>}
        </div>
      </div>
      <span className="pf2-card-chevron" aria-hidden="true"><IconChevronRight size={18} /></span>
    </a>
  );
}
