// Decision rules: a value is retained only when the AI proposal AND at
// least two grounded sources from two DIFFERENT sites (at least one
// institutional) agree, and the result passes plausibility rules. Values
// already present in plant_catalog go through the exact same rule.
// Pure, deterministic, no I/O.
//
// Product decisions encoded here:
// - publishable = the 4 critical blocks (plant_type, sun, height, spread)
//   are verified; evergreen / water_need / flowering_months are kept only
//   when verified, otherwise left empty, and never block publication;
// - flowering_months is not applicable to ferns and grasses (same list as
//   lib/plantQuality.js FLOWERING_NOT_APPLICABLE_TYPES — duplicated, never
//   imported, like editorialVocab.js does for the app's vocabularies).

import { SUN_VALUES, PLANT_TYPE_VALUES, WATER_NEED_VALUES } from "../editorial/editorialVocab.js";
import { TOLERANCES } from "./completionConfig.js";
import { normalizeName } from "./textParsers.js";

export const FLOWERING_NOT_APPLICABLE_TYPES = ["fern", "grass"];
export const CRITICAL = ["plant_type", "sun", "height", "spread"];
const OK_STATUSES = new Set(["verified", "existing_confirmed", "existing_corrected"]);

// Height bounds (cm) by plant type for the retained maximum height.
const HEIGHT_MAX_BOUNDS = {
  tree: [300, 4500],
  shrub: [20, 1200],
  perennial: [5, 300],
  annual: [5, 300],
  biennial: [10, 300],
  grass: [10, 500],
  fern: [10, 250],
  bulb: [5, 200],
  climber: [100, 3000],
  groundcover: [1, 100],
};

export function withinTolerance(a, b) {
  return Math.abs(a - b) <= Math.max(TOLERANCES.lengthRelative * Math.max(a, b), TOLERANCES.lengthAbsoluteCm);
}

function round10(v) {
  return Math.round(v / 10) * 10;
}

// One value per site; a site whose pages disagree is a conflict.
function perDomain(observations, trait) {
  const map = new Map();
  for (const o of observations.filter((x) => x.trait === trait)) {
    if (!map.has(o.domain)) map.set(o.domain, []);
    map.get(o.domain).push(o);
  }
  const domains = [];
  let conflict = false;
  for (const [domain, list] of map) {
    const keys = new Set(list.map((o) => JSON.stringify(o.value)));
    if (keys.size > 1) conflict = true;
    domains.push({ domain, value: list[0].value, obs: list[0] });
  }
  return { domains, conflict };
}

function enoughSources(domains) {
  return domains.length >= 2 && domains.some((d) => d.obs.institutional);
}

function result(status, value, domains, reasons = []) {
  return { status, value, sources: domains.map((d) => sourceRef(d.obs)), reasons };
}

function sourceRef(o) {
  return { domain: o.domain, publisher: o.publisher, institutional: o.institutional, url: o.url, title: o.title, retrieved_at: o.retrieved_at, license: o.license };
}

function insufficient(domains, conflict) {
  if (conflict) return ["sources_disagree (same site, different pages)"];
  if (domains.length < 2) return [`insufficient_sources (${domains.length} grounded site(s), 2 required)`];
  if (!domains.some((d) => d.obs.institutional)) return ["no_institutional_source"];
  return null;
}

// --- per-trait rules --------------------------------------------------------

function decideMember(observations, trait, aiValue) {
  const { domains, conflict } = perDomain(observations, trait);
  const why = insufficient(domains, conflict);
  if (why) return result("to_verify", null, domains, why);
  if (aiValue == null) return result("to_verify", null, domains, ["ai_no_value"]);
  const disagreeing = domains.filter((d) => !d.value.includes(aiValue));
  if (disagreeing.length) return result("to_verify", null, domains, [`sources_disagree (${disagreeing.map((d) => d.domain).join(", ")} do not state "${aiValue}")`]);
  return result("verified", aiValue, domains);
}

function decideBoolean(observations, trait, aiValue) {
  const { domains, conflict } = perDomain(observations, trait);
  const why = insufficient(domains, conflict);
  if (why) return result("to_verify", null, domains, why);
  if (aiValue == null) return result("to_verify", null, domains, ["ai_no_value"]);
  if (domains.some((d) => d.value !== aiValue)) return result("to_verify", null, domains, ["sources_disagree"]);
  return result("verified", aiValue, domains);
}

function decideSun(observations, aiValue) {
  const { domains, conflict } = perDomain(observations, "sun");
  const why = insufficient(domains, conflict);
  if (why) return result("to_verify", null, domains, why);
  const inter = SUN_VALUES.filter((v) => domains.every((d) => d.value.includes(v)));
  if (!inter.length) return result("to_verify", null, domains, ["sources_disagree (no common exposure)"]);
  if (!Array.isArray(aiValue) || !aiValue.some((v) => inter.includes(v))) return result("to_verify", null, domains, ["ai_disagrees"]);
  return result("verified", inter, domains);
}

function decideMonths(observations, aiValue) {
  const { domains, conflict } = perDomain(observations, "flowering_months");
  const why = insufficient(domains, conflict);
  if (why) return result("to_verify", null, domains, why);
  const sets = domains.map((d) => new Set(d.value));
  const union = new Set(domains.flatMap((d) => d.value));
  const inter = [...union].filter((m) => sets.every((s) => s.has(m))).sort((a, b) => a - b);
  if (!inter.length || inter.length / union.size < TOLERANCES.monthsOverlapRatio) {
    return result("to_verify", null, domains, ["sources_disagree (flowering periods overlap < 50 %)"]);
  }
  if (!Array.isArray(aiValue) || !aiValue.some((m) => inter.includes(m))) return result("to_verify", null, domains, ["ai_disagrees"]);
  return result("verified", inter, domains);
}

// lengths: trait "height" | "spread"; returns { max, min } decisions.
function decideLength(observations, trait, aiMax, aiMin) {
  const { domains, conflict } = perDomain(observations, trait);
  const out = {};

  // maximum
  const closed = domains.filter((d) => d.value.max_cm != null);
  const opens = domains.filter((d) => d.value.open_ended && d.value.min_cm != null);
  let maxRes;
  if (conflict) maxRes = result("to_verify", null, domains, ["sources_disagree (same site, different pages)"]);
  else if (closed.length >= 2) {
    const values = closed.map((d) => d.value.max_cm);
    const agree = values.every((a) => values.every((b) => withinTolerance(a, b)));
    const support = [...closed, ...opens.filter((o) => o.value.min_cm <= Math.max(...values) * (1 + TOLERANCES.lengthRelative))];
    if (!agree) maxRes = result("to_verify", null, closed, [`sources_disagree (${values.join(" / ")} cm)`]);
    else if (!enoughSources(support)) maxRes = result("to_verify", null, support, insufficient(support, false) || []);
    else maxRes = result("verified", round10(values.reduce((s, v) => s + v, 0) / values.length), support);
  } else if (closed.length === 1 && opens.length >= 1) {
    const m = closed[0].value.max_cm;
    const support = [closed[0], ...opens.filter((o) => o.value.min_cm <= m * (1 + TOLERANCES.lengthRelative))];
    if (support.length < 2) maxRes = result("to_verify", null, domains, ["sources_disagree (open-ended minimum above stated maximum)"]);
    else if (!enoughSources(support)) maxRes = result("to_verify", null, support, insufficient(support, false) || []);
    else maxRes = result("verified", round10(m), support);
  } else {
    maxRes = result("to_verify", null, closed, [`insufficient_sources (${closed.length} site(s) state a maximum)`]);
  }
  if (maxRes.status === "verified") {
    if (aiMax == null) maxRes = { ...maxRes, status: "to_verify", value: null, reasons: ["ai_no_value"] };
    else if (!withinTolerance(aiMax, maxRes.value)) maxRes = { ...maxRes, status: "to_verify", value: null, reasons: [`ai_disagrees (${aiMax} cm vs ${maxRes.value} cm)`] };
  }
  out.max = maxRes;

  // minimum (height only; optional)
  if (trait === "height") {
    const withMin = domains.filter((d) => d.value.min_cm != null);
    let minRes;
    if (conflict) minRes = result("to_verify", null, domains, ["sources_disagree (same site, different pages)"]);
    else if (withMin.length < 2) minRes = result("to_verify", null, withMin, [`insufficient_sources (${withMin.length} site(s) state a minimum)`]);
    else {
      const values = withMin.map((d) => d.value.min_cm);
      if (!values.every((a) => values.every((b) => withinTolerance(a, b)))) minRes = result("to_verify", null, withMin, [`sources_disagree (${values.join(" / ")} cm)`]);
      else if (!enoughSources(withMin)) minRes = result("to_verify", null, withMin, insufficient(withMin, false) || []);
      else {
        const v = round10(values.reduce((s, x) => s + x, 0) / values.length);
        if (aiMin == null) minRes = result("to_verify", null, withMin, ["ai_no_value"]);
        else if (!withinTolerance(aiMin, v)) minRes = result("to_verify", null, withMin, [`ai_disagrees (${aiMin} cm vs ${v} cm)`]);
        else minRes = result("verified", v, withMin);
      }
    }
    out.min = minRes;
  }
  return out;
}

function decideName(observations, aiName) {
  const { domains } = perDomain(observations, "common_name_fr");
  const byName = new Map();
  for (const d of domains) {
    const key = normalizeName(d.value);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d);
  }
  if (!aiName) return result("to_verify", null, domains, ["ai_no_value"]);
  const group = byName.get(normalizeName(aiName)) || [];
  const why = insufficient(group, false);
  if (why) return result("to_verify", null, domains, [`${why[0]} for "${aiName}"`]);
  const primary = group.find((d) => d.obs.institutional) || group[0];
  return result("verified", primary.value, group);
}

// --- plausibility -----------------------------------------------------------

export function plausibilityErrors(values) {
  const errors = [];
  const type = values.plant_type ?? null;
  if (type != null && !PLANT_TYPE_VALUES.includes(type)) errors.push(`plant_type "${type}" outside vocabulary`);
  if (values.sun != null && (!Array.isArray(values.sun) || !values.sun.every((v) => SUN_VALUES.includes(v)))) errors.push("sun outside vocabulary");
  if (values.water_need != null && !WATER_NEED_VALUES.includes(values.water_need)) errors.push("water_need outside vocabulary");
  if (values.flowering_months != null && !values.flowering_months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) errors.push("flowering_months outside 1-12");
  for (const k of ["height_min_cm", "height_max_cm", "spread_max_cm"]) {
    if (values[k] != null && !(values[k] > 0)) errors.push(`${k} must be > 0`);
  }
  if (values.height_min_cm != null && values.height_max_cm != null && values.height_min_cm > values.height_max_cm) errors.push("height_min_cm > height_max_cm");
  if (type && values.height_max_cm != null && HEIGHT_MAX_BOUNDS[type]) {
    const [lo, hi] = HEIGHT_MAX_BOUNDS[type];
    if (values.height_max_cm < lo || values.height_max_cm > hi) errors.push(`height_max_cm ${values.height_max_cm} implausible for ${type} (${lo}-${hi} cm)`);
  }
  if (values.spread_max_cm != null && values.height_max_cm != null && !["climber", "groundcover"].includes(type) && values.spread_max_cm > 3 * values.height_max_cm) {
    errors.push(`spread_max_cm ${values.spread_max_cm} > 3 × height_max_cm`);
  }
  return errors;
}

// --- existing values --------------------------------------------------------

function sameValue(column, a, b) {
  if (a == null || b == null) return false;
  if (["height_min_cm", "height_max_cm", "spread_max_cm"].includes(column)) return withinTolerance(Number(a), Number(b));
  if (Array.isArray(a) || Array.isArray(b)) {
    const sa = [...(a || [])].map(String).sort().join(",");
    const sb = [...(b || [])].map(String).sort().join(",");
    return sa === sb;
  }
  return a === b;
}

function isPresent(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  return true;
}

function applyExisting(decision, column, existingValue) {
  if (!isPresent(existingValue)) return { ...decision, existing: null, emit: decision.status === "verified" };
  if (decision.status === "verified") {
    return sameValue(column, existingValue, decision.value)
      ? { ...decision, status: "existing_confirmed", existing: existingValue, emit: false }
      : { ...decision, status: "existing_corrected", existing: existingValue, emit: true };
  }
  if (decision.status === "not_applicable") return { ...decision, existing: existingValue, emit: false };
  return { ...decision, status: "existing_unverified", existing: existingValue, emit: false };
}

// --- entry point -------------------------------------------------------------

// decidePlant({ proposal, observations, existing }) -> { columns, common_name_fr, publishable, critical }
// columns: plant_catalog column -> decision {status, value, sources, reasons, existing, emit}
export function decidePlant({ proposal, observations, existing }) {
  const p = proposal || {};
  const ex = existing || {};
  const obs = observations || [];

  const height = decideLength(obs, "height", p.height_max_cm ?? null, p.height_min_cm ?? null);
  const spread = decideLength(obs, "spread", p.spread_max_cm ?? null, null);

  const raw = {
    plant_type: decideMember(obs, "plant_type", p.plant_type ?? null),
    sun: decideSun(obs, p.sun ?? null),
    height_max_cm: height.max,
    height_min_cm: height.min,
    spread_max_cm: spread.max,
    evergreen: decideBoolean(obs, "evergreen", p.evergreen ?? null),
    water_need: decideMember(obs, "water_need", p.water_need ?? null),
  };

  const typeForFlowering = (raw.plant_type.status === "verified" ? raw.plant_type.value : null) ?? ex.plant_type ?? p.plant_type ?? null;
  raw.flowering_months = FLOWERING_NOT_APPLICABLE_TYPES.includes(typeForFlowering)
    ? { status: "not_applicable", value: null, sources: [], reasons: [`not applicable to ${typeForFlowering}`] }
    : decideMonths(obs, p.flowering_months ?? null);

  // plausibility on the values that would end up in the row
  const projected = {};
  for (const [col, d] of Object.entries(raw)) projected[col] = d.status === "verified" ? d.value : (ex[col] ?? null);
  const errors = plausibilityErrors(projected);
  if (errors.length) {
    for (const col of Object.keys(raw)) {
      const related = errors.filter((e) => e.includes(col) || (col === "plant_type" && /implausible for/.test(e)));
      if (related.length && raw[col].status === "verified") raw[col] = { ...raw[col], status: "to_verify", value: null, reasons: [`implausible: ${related.join("; ")}`] };
    }
  }

  const columns = {};
  for (const [col, d] of Object.entries(raw)) columns[col] = applyExisting(d, col, ex[col]);

  // French common name
  let name = decideName(obs, p.common_name_fr ?? null);
  if (ex.preferred_common_name_fr) {
    name = name.status === "verified" && normalizeName(name.value) === normalizeName(ex.preferred_common_name_fr)
      ? { ...name, status: "existing_confirmed", existing: ex.preferred_common_name_fr, emit: false }
      : { ...name, status: "existing_unverified", existing: ex.preferred_common_name_fr, emit: false, reasons: [...name.reasons, "a preferred French name already exists and is not confirmed — never replaced automatically"] };
  } else {
    name = { ...name, existing: null, emit: name.status === "verified" };
  }

  const ok = (col) => OK_STATUSES.has(columns[col].status);
  const critical = {
    plant_type: ok("plant_type"),
    sun: ok("sun"),
    height: ok("height_max_cm") || ok("height_min_cm"),
    spread: ok("spread_max_cm"),
  };
  return { columns, common_name_fr: name, critical, publishable: CRITICAL.every((k) => critical[k]) };
}
