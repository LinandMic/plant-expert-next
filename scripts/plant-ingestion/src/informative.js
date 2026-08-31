// Pure. Implements the "unknown = null, never [] or ''" rule (spec §15):
// false and 0 ARE informative values and must never be treated as unknown;
// [] and "" carry no information and must never be treated as a known
// empty-but-real value.
export function isInformative(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

// Returns `value` unchanged if informative, else `null` — never `[]`/`""`.
export function orNull(value) {
  return isInformative(value) ? value : null;
}
