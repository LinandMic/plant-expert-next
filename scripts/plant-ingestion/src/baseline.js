// Snapshot of facts validated against REAL provider APIs in an earlier live
// run (documented in the Plant Finder V1 design conversation). This module
// is a CONTROL BASELINE ONLY — see drift.js for the rule that nothing here
// is ever written into a live observation, source_record, selection, or
// catalog value. It exists solely so a later live run can flag when
// today's answer disagrees with what was previously observed.

export const ACER_PALMATUM_BASELINE = {
  perenual: {
    height_min_cm: 609.6,
    height_max_cm: 609.6,
    hardiness_min: 6,
    hardiness_max: 6,
  },
  trefle: {
    light_0_10: 7,
    soil_ph_min: 6.5,
    soil_ph_max: 7,
    height_available: false,
  },
};

export const BLOODGOOD_BASELINE = {
  perenual: {
    selection_reason: "exact_cultivar_match",
    height_min_cm: 609.6,
    height_max_cm: 609.6,
  },
  trefle: {
    provider_status: "not_found",
  },
};
