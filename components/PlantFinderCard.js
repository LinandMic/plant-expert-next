import { formatHeightRange, sunLabels, entryTypeLabel, plantTypeLabel, plantFinderDisplayTitle } from "@/lib/plantFinderFormat";
import { IconSprig, IconChevronRight } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n";

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
// is the optional vernacular name. When present, common_name leads as
// the card's title and display_name becomes the italic scientific subtitle —
// when absent, display_name is shown alone as the title.
//
// plant.imageUrl is nullable (most catalog rows have none yet — no image
// was ever fetched/generated automatically, see plantFinderApi.js). When
// present, it renders as a real photo; otherwise the same sober botanical
// placeholder as before — the thumbnail box itself stays a fixed size
// either way, so card height never depends on whether an image exists.
export default function PlantFinderCard({ plant, returnTo }) {
  const { t } = useI18n();
  const height = formatHeightRange(plant.heightMinCm, plant.heightMaxCm);
  const sun = sunLabels(plant.sun, t);
  const badgeLabel = entryTypeLabel(plant.entryType, t);
  const plantType = plantTypeLabel(plant.plantType, t);
  const href = `/plant-finder/${encodeURIComponent(plant.slug)}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;
  const { title, scientificSubtitle } = plantFinderDisplayTitle(plant);

  return (
    <a href={href} className="pf2-card">
      <div className="pf2-card-photo">
        {plant.imageUrl ? (
          <img src={plant.imageUrl} alt={plant.imageAlt || title} className="pf2-card-photo-img" loading="lazy" />
        ) : (
          <IconSprig size={26} />
        )}
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
