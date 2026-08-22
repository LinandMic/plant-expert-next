// Pure unit-conversion helpers. Only deterministic math is allowed here —
// never a botanical inference (see spec §9). raw_value/raw_unit are always
// kept alongside the converted value so nothing is lost.

export function metersToCm(value) {
  return typeof value === "number" && Number.isFinite(value) ? value * 100 : null;
}

export function feetToCm(value) {
  return typeof value === "number" && Number.isFinite(value) ? value * 30.48 : null;
}

export function inchesToCm(value) {
  return typeof value === "number" && Number.isFinite(value) ? value * 2.54 : null;
}

// Builds one observation for the multi-observation trait model (spec §8).
// Unknown/missing is always `null`, never 0, never a guessed default.
export function makeObservation({
  provider,
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
