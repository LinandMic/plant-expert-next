import { crosswalkSunArray } from "./crosswalks.js";
import { isInformative } from "./informative.js";

// Traits this dry-run may ever PROPOSE a selection for — a deterministic
// mapping rule exists for each. Every other trait may have observations,
// but never a proposed selection (spec §13).
const DETERMINISTIC_TRAITS = new Set(["height_min_cm", "height_max_cm", "plant_type"]);

function proposeDeterministicNumericOrPassthrough(trait, observations) {
  const withValue = observations.filter((o) => o.trait === trait && isInformative(o.normalized_value));
  if (withValue.length === 0) return { selection: null, warnings: [] };

  const distinctValues = [...new Set(withValue.map((o) => JSON.stringify(o.normalized_value)))];
  if (distinctValues.length > 1) {
    return {
      selection: null,
      warnings: [`${trait}: ${distinctValues.length} conflicting observed values — no selection proposed`],
    };
  }

  return {
    selection: {
      catalog_ref: withValue[0].catalog_ref,
      trait,
      observation_ref: withValue[0].observation_ref,
      normalized_value: withValue[0].normalized_value,
      status: "proposed",
    },
    warnings: [],
  };
}

function proposeSun(catalogRef, observations) {
  const sunObservations = observations.filter((o) => o.trait === "sun" && Array.isArray(o.raw_value));
  if (sunObservations.length === 0) return { selection: null, warnings: [] };

  // Only ever one Perenual `sun` observation per plant today (a single
  // array-valued field) — if more than one ever appears, do not silently
  // pick one.
  if (sunObservations.length > 1) {
    return { selection: null, warnings: ["sun: more than one raw sun observation — no selection proposed"] };
  }

  const obs = sunObservations[0];
  const { canonical, warnings } = crosswalkSunArray(obs.raw_value);
  if (!canonical) return { selection: null, warnings };

  return {
    selection: {
      catalog_ref: catalogRef,
      trait: "sun",
      observation_ref: obs.observation_ref,
      normalized_value: canonical,
      status: "proposed",
    },
    warnings,
  };
}

// proposeSelections({ catalogRef, observations }) -> { selections, warnings }
// Pure. `observations` is this catalog entry's own trait_observations[]
// (already built). Never proposes hardiness_min_rank/hardiness_max_rank —
// the USDA rank crosswalk does not exist yet (spec §12) — and always
// flags a "hardiness crosswalk not yet defined" warning when a raw
// hardiness observation exists, so the gap is visible rather than silent.
// Every proposed selection's observation_ref is guaranteed to reference an
// observation actually present in `observations` (test #14), because
// selections are only ever built FROM that same array.
export function proposeSelections({ catalogRef, observations }) {
  const selections = [];
  const warnings = [];

  for (const trait of ["height_min_cm", "height_max_cm", "plant_type"]) {
    if (!DETERMINISTIC_TRAITS.has(trait)) continue;
    const { selection, warnings: w } = proposeDeterministicNumericOrPassthrough(trait, observations);
    if (selection) selections.push(selection);
    warnings.push(...w);
  }

  const { selection: sunSelection, warnings: sunWarnings } = proposeSun(catalogRef, observations);
  if (sunSelection) selections.push(sunSelection);
  warnings.push(...sunWarnings);

  const hasHardinessObservation = observations.some((o) => o.trait === "hardiness_min" || o.trait === "hardiness_max");
  if (hasHardinessObservation) {
    warnings.push("hardiness crosswalk not yet defined — hardiness_min_rank/hardiness_max_rank left unselected");
  }

  return { selections, warnings };
}
