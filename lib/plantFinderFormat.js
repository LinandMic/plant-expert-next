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

export function entryTypeLabel(entryType) {
  if (entryType === "species") return "Espèce";
  if (entryType === "cultivar") return "Cultivar";
  return null;
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
