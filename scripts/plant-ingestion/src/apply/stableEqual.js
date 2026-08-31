// Deep equality for values that round-trip through Postgres jsonb columns
// (plant_source_records.metadata, plant_trait_observations.raw_value /
// normalized_value). Postgres does not guarantee to preserve the key order
// of a jsonb object between what a plan literal writes and what a SELECT
// later returns — comparing those with plain JSON.stringify(a) ===
// JSON.stringify(b) produces false positives (reports "changed" for data
// that is semantically identical, just serialized with keys in a
// different order). Found against real production data: the same
// Perenual `metadata` object, and the same `edible` trait raw_value
// object, round-tripped with different key orders.
//
// Rule (server/local only, no dependency):
//   - object keys: order ignored (a jsonb object is a map, not a sequence)
//   - array elements: order PRESERVED (an array like sun:["full_sun",
//     "partial_shade"] is meaningfully ordered data, not a set — swapping
//     elements changes what it means)
// A key missing entirely on one side is treated the same as that key
// being present with an explicit `null` — matching the `?? null`
// convention already used everywhere else in Layer C for scalar fields.

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// stableEqual(a, b) -> boolean
export function stableEqual(a, b) {
  const av = a ?? null;
  const bv = b ?? null;

  if (av === bv) return true; // identical primitives, or both null

  if (Array.isArray(av) || Array.isArray(bv)) {
    if (!Array.isArray(av) || !Array.isArray(bv)) return false;
    if (av.length !== bv.length) return false;
    return av.every((item, i) => stableEqual(item, bv[i]));
  }

  if (isPlainObject(av) || isPlainObject(bv)) {
    if (!isPlainObject(av) || !isPlainObject(bv)) return false;
    const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
    for (const key of keys) {
      if (!stableEqual(av[key], bv[key])) return false;
    }
    return true;
  }

  return false; // genuinely different primitives (numbers, strings, booleans)
}
