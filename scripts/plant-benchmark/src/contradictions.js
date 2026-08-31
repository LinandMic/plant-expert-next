// Simple, documented numeric divergence rule — the same explanation is
// echoed in output/report.md. Two numeric observations for the same
// trait/plant are flagged when EITHER:
//   - the larger value is at least 1.5x the smaller (ratio-based — catches
//     e.g. 100cm vs 300cm), OR
//   - the absolute difference exceeds a trait-specific floor (catches
//     small-scale traits where a ratio alone would be too lenient, e.g. a
//     soil pH of 5.5 vs 7.5, or 150cm vs 160cm should NOT trigger while
//     100cm vs 300cm should — spec §13).
// This is a heuristic for surfacing divergences worth a human look, never a
// botanical judgment about which provider is "right" — both values are
// always kept, nothing is resolved automatically.

const ABSOLUTE_FLOOR_BY_TRAIT = {
  height_min_cm: 50,
  height_max_cm: 50,
  spread_min_cm: 50,
  spread_max_cm: 50,
  soil_ph_min: 1,
  soil_ph_max: 1,
  min_temperature_c: 8,
  max_temperature_c: 8,
};
const DEFAULT_ABSOLUTE_FLOOR = 20;
const RATIO_THRESHOLD = 1.5;

export function detectContradiction(traitName, a, b) {
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const diff = hi - lo;
  const ratio = lo === 0 ? (hi === 0 ? 1 : Infinity) : hi / lo;
  const floor = ABSOLUTE_FLOOR_BY_TRAIT[traitName] ?? DEFAULT_ABSOLUTE_FLOOR;

  const ratioTriggered = ratio >= RATIO_THRESHOLD;
  const absoluteTriggered = diff >= floor;
  if (!ratioTriggered && !absoluteTriggered) return null;

  const severity = ratio >= 3 || diff >= floor * 3 ? "high" : "moderate";
  return {
    difference: Number(diff.toFixed(2)),
    ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
    severity,
  };
}
