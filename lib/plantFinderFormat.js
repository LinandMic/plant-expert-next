// Pure display-formatting helpers for the Plant Finder UI. Never touch the
// database values themselves — these only decide how an already-fetched
// value is shown. Unknown (null/undefined) is always distinct from a real
// falsy value (false, 0) — never rendered as if it were "false"/"0"/"aucun".

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
// absent value).
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
const SUN_LABELS = {
  full_sun: "Plein soleil",
  partial_sun: "Mi-ombre",
  bright_shade: "Ombre lumineuse",
  shade: "Ombre",
};

export function sunLabels(sunValues) {
  if (!Array.isArray(sunValues) || sunValues.length === 0) return null;
  return sunValues.map((v) => SUN_LABELS[v] || v);
}

// Single-value counterpart to sunLabels, for a single chip/checkbox label
// rather than a joined list. Unrecognized value -> null (never the raw slug).
export function sunLabel(value) {
  if (value === null || value === undefined) return null;
  return SUN_LABELS[value] || null;
}

// The whitelist of DB-valid sun values, in the same order as the CHECK
// constraint / SUN_LABELS above — the single source of truth reused by the
// filter UI and by filter normalization, so the two can never drift apart.
export const SUN_VALUES = Object.keys(SUN_LABELS);

// plant_catalog.plant_type raw DB values -> French UI label. The DB value
// itself is NEVER modified — this is presentation only. An unrecognized
// value is never guessed into a French label, and never shown as the raw
// technical slug either (that's exactly what this function exists to
// avoid) — it is hidden, the same way an absent value already is. null
// stays null.
const PLANT_TYPE_LABELS = {
  tree: "Arbre",
  shrub: "Arbuste",
  perennial: "Vivace",
  annual: "Annuelle",
  biennial: "Bisannuelle",
  grass: "Graminée",
  climber: "Grimpante",
  groundcover: "Couvre-sol",
  fern: "Fougère",
  bulb: "Bulbe",
};

export function plantTypeLabel(value) {
  if (value === null || value === undefined) return null;
  return PLANT_TYPE_LABELS[value] || null;
}

// The whitelist of DB-valid plant_type values, reused by filter
// normalization and by the filter <select> options.
export const PLANT_TYPE_VALUES = Object.keys(PLANT_TYPE_LABELS);

// The 4 adult-height filter categories (spec: derived from height_max_cm,
// never height_min_cm). This is a UI-facing category, not a DB column — the
// numeric bounds each category maps to live in lib/plantFinderFilters.js,
// which is the filtering concern; this map only owns the French label.
const HEIGHT_CATEGORY_LABELS = {
  small: "Petit",
  medium: "Moyen",
  large: "Grand",
  very_large: "Très grand",
};

export const HEIGHT_CATEGORY_VALUES = Object.keys(HEIGHT_CATEGORY_LABELS);

export function heightCategoryLabel(category) {
  if (category === null || category === undefined) return null;
  return HEIGHT_CATEGORY_LABELS[category] || null;
}

export function entryTypeLabel(entryType) {
  if (entryType === "species") return "Espèce";
  if (entryType === "cultivar") return "Cultivar";
  return null;
}

// plantFinderDisplayTitle({ commonName, displayName }) -> { title, scientificSubtitle }
// display_name is the scientific/cultivar name and is always populated by
// ingestion; common_name is the optional French vernacular name (see
// lib/plantFinderApi.js). When a common name exists it leads as the title
// and the scientific name becomes a secondary subtitle (spec: "nom commun ;
// nom scientifique en italique"); when it's absent, the scientific name
// alone is the title and there is no separate subtitle to avoid repeating
// it. Never fabricates either value — both are used exactly as fetched.
export function plantFinderDisplayTitle(plant) {
  const commonName = plant && plant.commonName;
  const displayName = plant && plant.displayName;
  return {
    title: commonName || displayName || null,
    scientificSubtitle: commonName && displayName ? displayName : null,
  };
}

// Generic null-safe boolean formatter: null/undefined stays unknown
// (returns null, never "Non"); true/false are both real, informative
// answers and are always rendered as such.
export function formatBoolean(value, labels = { yes: "Oui", no: "Non" }) {
  if (value === null || value === undefined) return null;
  return value ? labels.yes : labels.no;
}

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function formatFloweringMonths(months) {
  if (!Array.isArray(months) || months.length === 0) return null;
  const labels = months
    .filter((m) => isFiniteNumber(m) && m >= 1 && m <= 12)
    .sort((a, b) => a - b)
    .map((m) => MONTH_LABELS[m - 1]);
  return labels.length > 0 ? labels.join(", ") : null;
}
