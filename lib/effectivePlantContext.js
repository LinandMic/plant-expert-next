// Pure resolution of a plant's *effective* context (plant overrides zone) —
// no React, no network, no mutation. This is the single source of truth for
// the inheritance rule so it's never re-implemented ad hoc in a component.
// Never writes anything: inheritance stays dynamic — a zone change is
// reflected immediately for any plant without its own override, with zero
// writes to `plants`.
//
// Only these 6 fields are inheritable. location/wateringFlowLph/
// wateringEmitterCount are deliberately never read here — they stay
// strictly plant-only, by omission.

// null/undefined means "no plant override" — an explicit "unknown" or
// "manual" is a real value and must never fall through to the zone.
function resolveField(plantValue, zoneValue) {
  if (plantValue !== null && plantValue !== undefined) return { value: plantValue, source: "plant" };
  if (zoneValue !== null && zoneValue !== undefined) return { value: zoneValue, source: "zone" };
  return { value: null, source: null };
}

const NO_VALUE = { value: null, source: null };

export function getEffectivePlantContext(plantContext, zone) {
  const context = plantContext || {};
  const watering = context.watering || {};
  const z = zone || null;

  const exposure = resolveField(context.exposure ?? null, z ? z.exposure : null);
  const orientation = resolveField(context.orientation ?? null, z ? z.orientation : null);

  const plantMode = watering.mode ?? null;
  const wateringMode = resolveField(plantMode, z ? z.wateringMode : null);

  let wateringType = NO_VALUE;
  let wateringFrequencyDays = NO_VALUE;
  let wateringDurationMinutes = NO_VALUE;

  if (wateringMode.value === "automatic") {
    if (plantMode === "automatic") {
      // The plant itself opted into automatic — each detail may be
      // overridden independently, falling back to the zone's own detail.
      wateringType = resolveField(watering.type ?? null, z ? z.wateringType : null);
      wateringFrequencyDays = resolveField(watering.frequencyDays ?? null, z ? z.wateringFrequencyDays : null);
      wateringDurationMinutes = resolveField(watering.durationMinutes ?? null, z ? z.wateringDurationMinutes : null);
    } else {
      // plantMode is null: "automatic" itself is fully inherited from the
      // zone, so its details are too — read only from the zone here, never
      // from the plant (the DB's own CHECK constraint already guarantees a
      // plant with a null watering_mode has null detail columns, but this
      // function doesn't rely on that to be correct).
      if (z && z.wateringType !== null && z.wateringType !== undefined) {
        wateringType = { value: z.wateringType, source: "zone" };
      }
      if (z && z.wateringFrequencyDays !== null && z.wateringFrequencyDays !== undefined) {
        wateringFrequencyDays = { value: z.wateringFrequencyDays, source: "zone" };
      }
      if (z && z.wateringDurationMinutes !== null && z.wateringDurationMinutes !== undefined) {
        wateringDurationMinutes = { value: z.wateringDurationMinutes, source: "zone" };
      }
    }
  }
  // wateringMode.value !== "automatic" (manual, or no value at all): all
  // three detail fields stay { value: null, source: null } — never
  // inherited, regardless of any stray data found anywhere.

  return {
    exposure,
    orientation,
    wateringMode,
    wateringType,
    wateringFrequencyDays,
    wateringDurationMinutes,
  };
}
