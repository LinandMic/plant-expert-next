// Pure unit-conversion helpers. Only deterministic math is allowed here —
// never a botanical inference (spec §9). raw_value/raw_unit are always kept
// alongside the converted value so nothing is lost.

const CM_PER_UNIT = {
  cm: 1,
  centimeter: 1,
  centimeters: 1,
  m: 100,
  meter: 100,
  meters: 100,
  ft: 30.48,
  feet: 30.48,
  foot: 30.48,
  in: 2.54,
  inch: 2.54,
  inches: 2.54,
};

/**
 * convertToCm(value, unit) — deterministic, whitelisted units only.
 * Returns null (never a guess, never 0) if the value isn't a finite number
 * or the unit isn't one of the units this benchmark explicitly supports
 * (spec §2: "n'invente pas de conversion pour une unité inconnue").
 */
export function convertToCm(value, unit) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const key = (unit || "").trim().toLowerCase();
  const factor = CM_PER_UNIT[key];
  return factor === undefined ? null : value * factor;
}

// Builds one observation for the multi-observation trait model (spec §8).
// Unknown/missing is always `null`, never 0, never a guessed default.
// `fieldPath` disambiguates multiple observations of the SAME trait name
// that come from different response paths of the same provider (e.g.
// Trefle's `specifications.maximum_height` vs `growth.maximum_height`,
// spec §9) — they are never silently collapsed into one value.
export function makeObservation({
  provider,
  fieldPath = null,
  rawValue = null,
  rawUnit = null,
  normalizedValue = null,
  normalizedUnit = null,
  sourceRecordId = null,
  sourceUrl = null,
  license = null,
  attribution = null,
  retrievedAt = null,
  uncertain = false,
}) {
  return {
    provider,
    field_path: fieldPath,
    raw_value: rawValue,
    raw_unit: rawUnit,
    normalized_value: normalizedValue,
    normalized_unit: normalizedUnit,
    source_record_id: sourceRecordId,
    source_url: sourceUrl,
    license,
    attribution,
    retrieved_at: retrievedAt,
    uncertain,
  };
}

export function pushObservation(traits, traitName, observation) {
  if (!traits[traitName]) traits[traitName] = { trait: traitName, observations: [] };
  traits[traitName].observations.push(observation);
}
