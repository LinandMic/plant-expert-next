import { crosswalkSunArray, crosswalkPlantTypeValue } from "./crosswalks.js";

// applyDeterministicNormalizations(observations) -> { observations, warnings }
// Pure. Overwrites `normalized_value` on the OBSERVATION itself for traits
// with an explicit, deterministic crosswalk (currently: sun, plant_type) —
// the reused benchmark provider code never crosswalks Plant-Finder-specific
// vocabulary (by design), so its own `normalized_value` for these traits is
// just the raw passthrough. This must run BEFORE selection proposal: a
// proposed selection only ever copies observation.normalized_value verbatim
// (see selections.js), so normalizing here first is what guarantees
// selection.normalized_value === observation.normalized_value by
// construction, never a second independent computation that could drift.
export function applyDeterministicNormalizations(observations) {
  const warnings = [];
  const normalized = observations.map((obs) => {
    if (obs.trait === "sun") {
      const { canonical, warnings: sunWarnings } = crosswalkSunArray(obs.raw_value);
      warnings.push(...sunWarnings);
      return { ...obs, normalized_value: canonical };
    }
    if (obs.trait === "plant_type") {
      const canonical = crosswalkPlantTypeValue(obs.raw_value);
      if (canonical === null && obs.raw_value != null) {
        warnings.push(`plant_type crosswalk: unmapped provider value "${obs.raw_value}" — normalization left incomplete, no canonical value produced for this observation`);
      }
      return { ...obs, normalized_value: canonical };
    }
    return obs;
  });
  return { observations: normalized, warnings };
}
