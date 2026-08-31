// Drift detection ONLY. Every function here is pure and read-only against
// the ALREADY-BUILT source_records/observations of the current live run —
// it never constructs, injects, or mutates an observation, source_record,
// selection, or catalog value, and it never returns anything but a
// warnings[] array. A baseline value is compared against, never
// substituted in.
//
// Critically: a provider whose CURRENT source_record is not a trustworthy
// "ok" result (provider_error, skipped_no_key, plan_restricted,
// unresolved_under_plan, not_found for a field that requires a record) is
// never compared against the baseline as if it were a real disagreement —
// there is no live answer to compare, so no drift warning is produced for
// that field, and the baseline value is never used as a stand-in for the
// missing live one.

import { ACER_PALMATUM_BASELINE, BLOODGOOD_BASELINE } from "./baseline.js";

function findSourceRecord(sourceRecords, provider) {
  return (sourceRecords || []).find((s) => s.provider === provider) || null;
}

function findObservation(observations, provider, trait) {
  return (observations || []).find((o) => o.provider === provider && o.trait === trait) || null;
}

// A source_record is only "comparable" when the provider actually
// returned usable data this run (provider_status === "ok"). provider_error
// / skipped_no_key / plan_restricted / unresolved_under_plan / not_found
// all mean "no trustworthy live answer" — never compared, never a trigger
// to fall back to the baseline value.
function isComparable(sourceRecord) {
  return Boolean(sourceRecord) && sourceRecord.provider_status === "ok";
}

function driftWarning({ provider, field, baselineValue, liveValue }) {
  return `drift: ${provider}.${field} — baseline (previous validated run) = ${JSON.stringify(baselineValue)}, live (this run) = ${JSON.stringify(liveValue)}`;
}

// checkAcerSpeciesDrift({ sourceRecords, observations }) -> warnings[]
// Only ever called for the literal "Acer palmatum" species input (see
// bundle.js) — never applied to any other plant.
export function checkAcerSpeciesDrift({ sourceRecords, observations }) {
  const warnings = [];
  const baseline = ACER_PALMATUM_BASELINE;

  const perenualSr = findSourceRecord(sourceRecords, "perenual");
  if (isComparable(perenualSr)) {
    for (const field of ["height_min_cm", "height_max_cm"]) {
      const obs = findObservation(observations, "perenual", field);
      if (obs && obs.normalized_value !== null && obs.normalized_value !== baseline.perenual[field]) {
        warnings.push(driftWarning({ provider: "perenual", field, baselineValue: baseline.perenual[field], liveValue: obs.normalized_value }));
      }
    }
  }

  const trefleSr = findSourceRecord(sourceRecords, "trefle");
  if (isComparable(trefleSr) && baseline.trefle.height_available === false) {
    for (const field of ["height_min_cm", "height_max_cm"]) {
      const obs = findObservation(observations, "trefle", field);
      if (obs && obs.normalized_value !== null) {
        warnings.push(driftWarning({ provider: "trefle", field, baselineValue: "no usable height (previous run)", liveValue: obs.normalized_value }));
      }
    }
  }

  return warnings;
}

// checkBloodgoodDrift({ sourceRecords }) -> warnings[]
// Only ever called for the literal "Acer palmatum 'Bloodgood'" cultivar
// input (see bundle.js) — never applied to any other plant.
export function checkBloodgoodDrift({ sourceRecords }) {
  const warnings = [];
  const baseline = BLOODGOOD_BASELINE;

  const perenualSr = findSourceRecord(sourceRecords, "perenual");
  if (isComparable(perenualSr) && perenualSr.selection_reason !== baseline.perenual.selection_reason) {
    warnings.push(driftWarning({ provider: "perenual", field: "selection_reason", baselineValue: baseline.perenual.selection_reason, liveValue: perenualSr.selection_reason }));
  }

  const trefleSr = findSourceRecord(sourceRecords, "trefle");
  // Comparable here means "the call itself completed" — not_found IS a
  // trustworthy, comparable outcome (unlike provider_error/skipped_no_key).
  const trefleCallCompleted = Boolean(trefleSr) && trefleSr.provider_status !== "provider_error" && trefleSr.provider_status !== "skipped_no_key";
  if (trefleCallCompleted && trefleSr.provider_status !== baseline.trefle.provider_status) {
    warnings.push(driftWarning({ provider: "trefle", field: "provider_status", baselineValue: baseline.trefle.provider_status, liveValue: trefleSr.provider_status }));
  }

  return warnings;
}
