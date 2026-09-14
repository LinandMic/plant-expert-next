// Pure display-formatting helpers for the Plant Finder UI. Never touch the
// database values themselves — these only decide how an already-fetched
// value is shown. Unknown (null/undefined) is always distinct from a real
// falsy value (false, 0) — never rendered as if it were "false"/"0"/"aucun".
//
// Every label-lookup helper below takes `t` (the active useI18n().t
// function) as its last argument — the DB value itself (the map key) is
// never touched, only the displayed label changes with the locale.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// French-locale number: integers show no decimal, non-integers show
// exactly one decimal with a comma (never "609,600000").
function formatFrenchNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

// Values under 100cm are shown in cm (rounded to the nearest cm); values at
// or above 100cm are shown in meters (rounded to one decimal).
function toDisplayUnit(cm, forcedUnit) {
  const unit = forcedUnit || (cm >= 100 ? "m" : "cm");
  const value = unit === "cm" ? Math.round(cm) : Math.round((cm / 100) * 10) / 10;
  return { value, unit };
}

function formatSingleLength(cm) {
  const { value, unit } = toDisplayUnit(cm);
  return `${formatFrenchNumber(value)} ${unit}`;
}

// formatHeightRange(minCm, maxCm) -> "6,1 m" | "3–5 m" | "45 cm" | null
// null when neither bound is known — never a fabricated "0" or "Non
// renseigné" baked into the string (the caller decides how to label an
// absent value). Units/number formatting stay locale-invariant this round.
export function formatHeightRange(minCm, maxCm) {
  const hasMin = isFiniteNumber(minCm);
  const hasMax = isFiniteNumber(maxCm);
  if (!hasMin && !hasMax) return null;

  if (hasMin && hasMax && minCm === maxCm) {
    return formatSingleLength(minCm);
  }

  if (hasMin && hasMax) {
    // A single shared unit for the whole range, chosen from the larger
    // bound, so "80cm–1.5m" never happens.
    const unit = maxCm >= 100 ? "m" : "cm";
    const min = toDisplayUnit(minCm, unit);
    const max = toDisplayUnit(maxCm, unit);
    return `${formatFrenchNumber(min.value)}–${formatFrenchNumber(max.value)} ${unit}`;
  }

  return formatSingleLength(hasMin ? minCm : maxCm);
}

// Only the 4 crosswalked plant_catalog.sun values (spec §6) — DB values
// only, never invented. sun=null or [] both mean "not recorded" -> null.
export const SUN_VALUES = ["full_sun", "partial_sun", "bright_shade", "shade"];

export function sunLabels(sunValues, t) {
  if (!Array.isArray(sunValues) || sunValues.length === 0) return null;
  return sunValues.map((v) => (SUN_VALUES.includes(v) ? t(`format.sun.${v}`) : v));
}

// Single-value counterpart to sunLabels, for a single chip/checkbox label
// rather than a joined list. Unrecognized value -> null (never the raw slug).
export function sunLabel(value, t) {
  if (value === null || value === undefined || !SUN_VALUES.includes(value)) return null;
  return t(`format.sun.${value}`);
}

// plant_catalog.plant_type raw DB values -> UI label. The DB value itself
// is NEVER modified — this is presentation only. An unrecognized value is
// never guessed into a label, and never shown as the raw technical slug
// either (that's exactly what this function exists to avoid) — it is
// hidden, the same way an absent value already is. null stays null.
export const PLANT_TYPE_VALUES = [
  "tree", "shrub", "perennial", "annual", "biennial", "grass", "climber", "groundcover", "fern", "bulb",
];

export function plantTypeLabel(value, t) {
  if (value === null || value === undefined || !PLANT_TYPE_VALUES.includes(value)) return null;
  return t(`format.plantType.${value}`);
}

// The 4 adult-height filter categories (spec: derived from height_max_cm,
// never height_min_cm). This is a UI-facing category, not a DB column — the
// numeric bounds each category maps to live in lib/plantFinderFilters.js,
// which is the filtering concern; this map only owns the label.
export const HEIGHT_CATEGORY_VALUES = ["small", "medium", "large", "very_large"];

export function heightCategoryLabel(category, t) {
  if (category === null || category === undefined || !HEIGHT_CATEGORY_VALUES.includes(category)) return null;
  return t(`format.heightCategory.${category}`);
}

export function entryTypeLabel(entryType, t) {
  if (entryType === "species") return t("format.entryType.species");
  if (entryType === "cultivar") return t("format.entryType.cultivar");
  return null;
}

// plantFinderDisplayTitle(plant, locale) -> { title, scientificSubtitle }
// display_name is the scientific/cultivar botanical name (e.g. "Acer
// palmatum 'Bloodgood'") and is always populated by ingestion; the
// preferred vernacular name comes from plant_common_names, one taxon-level
// name per locale (fr/en), never from the old single-locale
// plant_catalog.common_name field (see lib/plantFinderApi.js — that field
// is kept on the Plant shape for backward compatibility only and is not
// read here).
//
// locale picks preferredCommonNameFr vs preferredCommonNameEn; an
// unrecognized/missing locale falls back to fr, same as the rest of the
// i18n layer's own default (lib/i18n/core.js's DEFAULT_LOCALE). When the
// active locale's preferred name exists it leads as the title and the
// botanical name becomes a secondary subtitle — this is also where a
// cultivar's identity ("'Bloodgood'") stays visible: display_name is never
// replaced, only demoted to a subtitle, so the common name (which belongs
// to the taxon, e.g. "Érable japonais" for the whole species) never erases
// which cultivar this is. When no preferred name exists for the active
// locale, the botanical name alone is the title (fallback — never a blank
// title) and there is no separate subtitle, to avoid repeating it. Never
// fabricates either value — both are used exactly as fetched.
export function plantFinderDisplayTitle(plant, locale) {
  const displayName = plant && plant.displayName;
  const preferredCommonName = plant && (locale === "en" ? plant.preferredCommonNameEn : plant.preferredCommonNameFr);
  return {
    title: preferredCommonName || displayName || null,
    scientificSubtitle: preferredCommonName && displayName ? displayName : null,
  };
}

// Generic null-safe boolean formatter: null/undefined stays unknown
// (returns null, never "Non"/"No"); true/false are both real, informative
// answers and are always rendered as such.
export function formatBoolean(value, t) {
  if (value === null || value === undefined) return null;
  return value ? t("format.boolYes") : t("format.boolNo");
}

export function formatFloweringMonths(months, t) {
  if (!Array.isArray(months) || months.length === 0) return null;
  const monthLabels = t("format.months");
  const labels = months
    .filter((m) => isFiniteNumber(m) && m >= 1 && m <= 12)
    .sort((a, b) => a - b)
    .map((m) => monthLabels[m - 1]);
  return labels.length > 0 ? labels.join(", ") : null;
}
