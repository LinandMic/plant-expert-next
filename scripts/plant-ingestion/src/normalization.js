import { crosswalkSunArray } from "./crosswalks.js";

// applyDeterministicNormalizations(observations) -> { observations, warnings }
// Pure. Overwrites `normalized_value` on the OBSERVATION itself for traits
// with an explicit, deterministic crosswalk (currently: sun) — the reused
// benchmark provider code never crosswalks Plant-Finder-specific vocabulary
// (by design), so its own `normalized_value` for "sun" is just the raw
// passthrough. This must run BEFORE selection proposal: a proposed
// selection only ever copies observation.normalized_value verbatim (see
// selections.js), so normalizing here first is what guarantees
// selection.normalized_value === observation.normalized_value by
// construction, never a second independent computation that could drift.
export function applyDeterministicNormalizations(observations) {
  const warnings = [];
  const normalized = observations.map((obs) => {
    if (obs.trait !== "sun") return obs;
    const { canonical, warnings: sunWarnings } = crosswalkSunArray(obs.raw_value);
    warnings.push(...sunWarnings);
    return { ...obs, normalized_value: canonical };
  });
  return { observations: normalized, warnings };
}
