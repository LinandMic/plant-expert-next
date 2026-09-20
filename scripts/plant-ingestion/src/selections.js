import { isInformative } from "./informative.js";

// Traits this dry-run may ever PROPOSE a selection for — a deterministic
// mapping rule exists for each. Every other trait may have observations,
// but never a proposed selection (spec §13).
//
// spread_max_cm (number) and evergreen (boolean) reuse
// proposeDeterministicNumericOrPassthrough exactly as-is: no new resolver,
// no trait-specific logic, no crosswalk needed — their raw provider value
// already IS the canonical shape (a number or a boolean). A trait is
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
// a real crosswalk the same way sun now has one.
//
// plant_type is deliberately EXCLUDED too (removed after auditing
// batch-12, 2026-09) — this is a TRUST-policy change, not a taxonomy or
// crosswalk change. Real regression: Perenual returned raw plant_type
// "Shrub" for Alcea rosea (a herbaceous biennial/short-lived perennial)
// and for Brunnera macrophylla (a herbaceous perennial), and "Tree" for
// Alnus glutinosa (in fact correct, but from the same unreliable source) —
// all three normalized to a syntactically canonical PLANT_TYPE_VALUES
// entry via crosswalkPlantTypeValue, so the exact-match crosswalk gate
// (which only ever guards against unmapped/garbage strings) passed clean
// and the wrong values were auto-selected verbatim. A canonical string
// from a single provider is no longer sufficient evidence — plant_type
// observations are still collected and still crosswalked exactly as
// before (see normalization.js), just never promoted into a
// trait_selection here. It becomes selectable again only via (1) a real
// future independent-corroboration mechanism (a second, distinct source
// agreeing), or (2) editorial/manual curation — never via a biological
// heuristic (family, genus, growth_form, Poaceae, woody habit, taxonomy).
//
// IMPORTANT — "never promoted into a trait_selection" is NOT the same as
// "can never inform a biological-applicability guard" (correction after
// the first cut of this change dormant-ed proposeFloweringMonths's
// plant_type route entirely, which was wrong): a reliable, non-uncertain,
// provider-agreed plant_type="fern" observation is still real evidence
// that flowering_months cannot apply, even though it is never trusted
// enough to become the catalog's plant_type itself. See
// proposeSelections' plantTypeGuard below — it reuses this exact same
// eligibility/agreement computation (proposeDeterministicNumericOrPassthrough)
// purely as an internal signal into proposeFloweringMonths, never adding
// anything to `selections`.
//
// flowering_months is deliberately NOT in this generic set (removed after
// auditing mini-batch-5, 2026-09) — it needs the same catalog entry's
// plant_type context before it can be safely proposed (see
// proposeFloweringMonths below), so it is handled as its own step in
// proposeSelections, the same way sun already is.
const DETERMINISTIC_TRAITS = new Set(["height_min_cm", "height_max_cm", "spread_max_cm", "evergreen"]);

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

// WCVP families confirmed, from real GBIF/WCVP lookups actually run by this
// pipeline, to be ferns (spore-bearing, non-flowering vascular plants —
// Polypodiopsida) — never flowering-capable regardless of provider data.
// This is NOT an attempt at an exhaustive list of the ~30 recognized fern
// families worldwide: it only ever grows by adding a family this pipeline
// has itself observed on a real ACCEPTED WCVP fern taxon, never by guessing
// ahead. Real regression (mini-batch-10, live Mac run): Osmunda regalis
// (family Osmundaceae, WCVP key 207447382, ACCEPTED) got no plant_type
// observation from any provider at all, so the plant_type="fern" gate above
// never triggered, and Trefle's flowering_months=[5,6,7] was auto-selected
// for a fern. Families below, each confirmed on a real ACCEPTED fern taxon
// resolved by this pipeline: Polypodiaceae (Dryopteris filix-mas,
// mini-batch-5; Polystichum setiferum, mini-batch-7 — this WCVP dataset
// uses a broad, older circumscription that groups several modern fern
// families under this name), Aspleniaceae (Asplenium scolopendrium,
// mini-batch-6; Athyrium filix-femina, mini-batch-8; Onoclea
// struthiopteris, mini-batch-9), Osmundaceae (Osmunda regalis,
// mini-batch-10). This set deliberately does NOT feed plant_type — it only
// gates flowering_months applicability, a taxonomic fact independent of
// the conservative provider-only plant_type classification.
const NON_FLOWERING_FAMILIES = new Set(["Polypodiaceae", "Aspleniaceae", "Osmundaceae"]);

export function isNonFloweringFamily(family) {
  return Boolean(family) && NON_FLOWERING_FAMILIES.has(family);
}

// proposeFloweringMonths — reuses proposeDeterministicNumericOrPassthrough
// exactly as before for the raw computation (same eligibility/conflict
// rules as every other deterministic trait), then applies two independent
// gates, either of which withholds the selection even though the provider
// data was otherwise clean:
//   1. plant_type gate — if THIS SAME catalog entry's plant_type, computed
//      by proposeSelections via the exact same eligibility/agreement rule
//      as every other deterministic trait (non-uncertain observations,
//      all agreeing — see plantTypeGuard below), resolves to a value in
//      PLANT_TYPES_WITHOUT_FLOWERING_MONTHS. This is a read-only guard
//      value, never a trait_selection — an uncertain or conflicting
//      plant_type observation is excluded from it exactly as it would
//      have been excluded from an actual selection (same helper, same
//      rules), so an ambiguous "fern" reading can never silently gate a
//      trait either.
//   2. taxonomic-family gate — if the resolved WCVP family is a confirmed
//      fern family (NON_FLOWERING_FAMILIES above), regardless of whether
//      any provider ever returned a plant_type observation at all. This is
//      what catches Osmunda regalis: no provider plant_type observation
//      exists, so gate 1 never fires, but the family is taxonomically
//      known and reliable (spec: applicability of a trait may use explicit
//      taxonomic information even where classification itself must stay
//      conservative).
// Neither gate ever mutates plant_type or invents one — the underlying
// flowering_months observation is untouched either way — this only ever
// affects promotion into a selection, never data collection (spec:
// "l'observation Trefle... peut rester stockée avec provenance").
function proposeFloweringMonths(observations, { plantTypeValue, family } = {}) {
  const { selection, warnings } = proposeDeterministicNumericOrPassthrough("flowering_months", observations);
  if (!selection) return { selection: null, warnings };

  if (plantTypeValue && PLANT_TYPES_WITHOUT_FLOWERING_MONTHS.has(plantTypeValue)) {
    return {
      selection: null,
      warnings: [`flowering_months: plant_type is "${plantTypeValue}" — not botanically applicable, no selection proposed despite an otherwise clean provider observation`],
    };
  }

  if (isNonFloweringFamily(family)) {
    return {
      selection: null,
      warnings: [`flowering_months: WCVP family "${family}" is a confirmed non-flowering (fern) family — not botanically applicable, no selection proposed despite an otherwise clean provider observation`],
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
export function proposeSelections({ observations, family = null }) {
  const selections = [];
  const warnings = [];

  for (const trait of DETERMINISTIC_TRAITS) {
    const { selection, warnings: w } = proposeDeterministicNumericOrPassthrough(trait, observations);
    if (selection) selections.push(selection);
    warnings.push(...w);
  }

  // plant_type is never pushed into `selections` (see DETERMINISTIC_TRAITS
  // comment above) — but proposeFloweringMonths still needs a reliable
  // signal for its plant_type gate. plantTypeGuard reuses the exact same
  // computation a real plant_type selection would have used (eligible()
  // excludes uncertain observations; a conflict across providers yields
  // null, never a guess) — it is discarded immediately after this call,
  // never added to `selections`, never surfaced as a warning, never used
  // to infer or score plant_type itself.
  const plantTypeGuard = proposeDeterministicNumericOrPassthrough("plant_type", observations).selection;
  const { selection: floweringSelection, warnings: floweringWarnings } = proposeFloweringMonths(observations, {
    plantTypeValue: plantTypeGuard ? plantTypeGuard.normalized_value : null,
    family,
  });
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
