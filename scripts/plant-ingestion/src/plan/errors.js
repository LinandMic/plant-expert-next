// Structured, explicit compiler errors. Every rejection in the planner
// uses this shape — never a silent drop, never a silent "pick the first
// one" correction (spec §4/§6: "Ne modifie jamais le bundle pour le faire
// passer : FAIL explicite").
export function planError(code, message, context = {}) {
  return { code, message, context };
}
