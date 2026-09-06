import { isInformative } from "./informative.js";

// Traits this dry-run may ever PROPOSE a selection for — a deterministic
// mapping rule exists for each. Every other trait may have observations,
// but never a proposed selection (spec §13).
//
// spread_max_cm (number) and evergreen (boolean) reuse
// proposeDeterministicNumericOrPassthrough exactly as-is: no new resolver,
// no trait-specific logic, no crosswalk needed — their raw provider value
// already IS the canonical shape (a number or a boolean). plant_type ALSO
// reuses this same function, but only after normalization.js's
// applyDeterministicNormalizations has already crosswalked its raw
// provider string into the canonical PLANT_TYPE_VALUES vocabulary (or
// null) — proposeDeterministicNumericOrPassthrough
// itself still never sees or applies that crosswalk, it only ever copies
// whatever normalized_value the observation already carries. A trait is
// proposed only when every non-uncertain observation for it (any provider)
// agrees; any genuine disagreement still blocks the proposal entirely (see
// proposeDeterministicNumericOrPassthrough below), never a Perenual-wins or
// Trefle-wins tiebreak.
//
// growth_form is deliberately EXCLUDED (removed after auditing mini-batch-2,
// 2026-09): it has no DB CHECK constraint and no application-level
// whitelist anywhere in this codebase (confirmed: not rendered by any
// Finder UI code today — see editorial/editorialVocab.js's own note on the
// same gap for editorial curation). Without a canonical vocabulary, a raw
// provider string like Trefle's "Thicket Forming" or "Bunch" would have
// been auto-selected verbatim, exactly the same class of bug plant_type
// just had. Observations for growth_form are still collected normally
// (buildObservations in provenance.js does not consult this set at all) —
// only the automatic PROMOTION into a trait_selection is disabled, pending
// a real crosswalk the same way sun/plant_type now have one.
// flowering_months is deliberately NOT in this generic set (removed after
// auditing mini-batch-5, 2026-09) — it needs the same catalog entry's
// plant_type context before it can be safely proposed (see
// proposeFloweringMonths below), so it is handled as its own step in
// proposeSelections, the same way sun already is.
const DETERMINISTIC_TRAITS = new Set(["height_min_cm", "height_max_cm", "plant_type", "spread_max_cm", "evergreen"]);

// An observation flagged `uncertain` is never eligible for an automatic
// proposal — this is the same `uncertain` flag used for genuine
// data/matching doubt (e.g. an unresolved taxonomy ambiguity, see
// taxonomyAmbiguity.js), reused exactly for what it was designed for:
// blocking automatic selection until the doubt is resolved.
function eligible(observations, trait) {
  return observations.filter((o) => o.trait === trait && !o.uncertain);
}

function proposeDeterministicNumericOrPassthrough(trait, observations) {
  const withValue = eligible(observations, trait).filter((o) => isInformative(o.normalized_value));
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

// plant_type values for which flowering_months is never botanically
// applicable — never auto-selected from provider data, however clean it
// looks. Deliberately a single, justified case, not a general
// "non-flowering plant_type" heuristic invented without evidence (spec:
// "Ne pas généraliser à d'autres plant_types sans justification").
// Real regression: mini-batch-5's live Mac run had Trefle propose
// flowering_months=[6,7,8,9,10] for Dryopteris filix-mas (a fern) alongside
// a correctly-selected plant_type="fern" — ferns reproduce by spores, they
// have no flowers, so this trait can never be a real botanical fact for
// them regardless of what a provider's data pipeline happens to return.
const PLANT_TYPES_WITHOUT_FLOWERING_MONTHS = new Set(["fern"]);

// proposeFloweringMonths — reuses proposeDeterministicNumericOrPassthrough
// exactly as before for the raw computation (same eligibility/conflict
// rules as every other deterministic trait), then applies one additional,
// context-aware gate: if THIS SAME catalog entry's plant_type has already
// been resolved (in this same proposeSelections call, from this same
// observations array — never a second independent lookup) to a value in
// PLANT_TYPES_WITHOUT_FLOWERING_MONTHS, the selection is withheld even
// though the provider data was otherwise clean. The underlying observation
// is untouched by this — this only ever affects promotion into a selection,
// never data collection (spec: "l'observation Trefle... peut rester
// stockée avec provenance").
function proposeFloweringMonths(observations, plantTypeValue) {
  const { selection, warnings } = proposeDeterministicNumericOrPassthrough("flowering_months", observations);
  if (!selection) return { selection: null, warnings };

  if (plantTypeValue && PLANT_TYPES_WITHOUT_FLOWERING_MONTHS.has(plantTypeValue)) {
    return {
      selection: null,
      warnings: [`flowering_months: plant_type is "${plantTypeValue}" — not botanically applicable, no selection proposed despite an otherwise clean provider observation`],
    };
  }

  return { selection, warnings };
}

// proposeSun — the sun observation's normalized_value is ALREADY the
// crosswalked canonical array (or null) by the time this runs — see
// normalization.js's applyDeterministicNormalizations, which must run
// before proposeSelections. This function never recomputes the crosswalk
// itself; it only copies observation.normalized_value verbatim, which is
// exactly what guarantees selection.normalized_value ===
// observation.normalized_value (spec §2's invariant) rather than a second
// independent computation that could silently drift from the first.
function proposeSun(observations) {
  const sunObservations = eligible(observations, "sun");
  if (sunObservations.length === 0) return { selection: null, warnings: [] };

  // Only ever one Perenual `sun` observation per plant today (a single
  // array-valued field) — if more than one ever appears, do not silently
  // pick one.
  if (sunObservations.length > 1) {
    return { selection: null, warnings: ["sun: more than one raw sun observation — no selection proposed"] };
  }

  const obs = sunObservations[0];
  if (!isInformative(obs.normalized_value)) {
    // Either nothing informative was ever raw-observed, or the crosswalk
    // was incomplete (a warning for that was already produced by
    // applyDeterministicNormalizations) — either way, no proposal.
    return { selection: null, warnings: [] };
  }

  return {
    selection: {
      catalog_ref: obs.catalog_ref,
      trait: "sun",
      observation_ref: obs.observation_ref,
      normalized_value: obs.normalized_value,
      status: "proposed",
    },
    warnings: [],
  };
}

// proposeSelections({ observations }) -> { selections, warnings }
// Pure. `observations` is this catalog entry's own trait_observations[]
// (already built, and already run through applyDeterministicNormalizations
// — see normalization.js). Never proposes hardiness_min_rank/
// hardiness_max_rank — the USDA rank crosswalk does not exist yet (spec
// §12) — and always flags a "hardiness crosswalk not yet defined" warning
// when a raw hardiness observation exists, so the gap is visible rather
// than silent. Every proposed selection's observation_ref is guaranteed to
// reference an observation actually present in `observations` (test #14),
// and its normalized_value is always copied verbatim from that same
// observation (test: selection/observation normalized_value invariant),
// because selections are only ever built FROM that same array, never a
// second independent computation.
export function proposeSelections({ observations }) {
  const selections = [];
  const warnings = [];

  for (const trait of DETERMINISTIC_TRAITS) {
    const { selection, warnings: w } = proposeDeterministicNumericOrPassthrough(trait, observations);
    if (selection) selections.push(selection);
    warnings.push(...w);
  }

  const plantTypeSelection = selections.find((s) => s.trait === "plant_type");
  const { selection: floweringSelection, warnings: floweringWarnings } = proposeFloweringMonths(
    observations,
    plantTypeSelection ? plantTypeSelection.normalized_value : null
  );
  if (floweringSelection) selections.push(floweringSelection);
  warnings.push(...floweringWarnings);

  const { selection: sunSelection, warnings: sunWarnings } = proposeSun(observations);
  if (sunSelection) selections.push(sunSelection);
  warnings.push(...sunWarnings);

  const hasHardinessObservation = observations.some((o) => o.trait === "hardiness_min" || o.trait === "hardiness_max");
  if (hasHardinessObservation) {
    warnings.push("hardiness crosswalk not yet defined — hardiness_min_rank/hardiness_max_rank left unselected");
  }

  return { selections, warnings };
}
