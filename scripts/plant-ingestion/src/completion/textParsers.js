// Deterministic parsers: short factual passage (quoted from a fetched page)
// -> normalized trait value. The value that is ever retained always comes
// from HERE, i.e. from the page text itself, never from a model's claim
// about that text. Pure, no I/O. EN + FR wording.
//
// Each parser returns null when the passage does not unambiguously state a
// value — an unparseable source simply does not count.

import { SUN_VALUES, PLANT_TYPE_VALUES, WATER_NEED_VALUES } from "../editorial/editorialVocab.js";

// Lowercase, strip accents, unify dashes/quotes/spaces.
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Same folding used to compare common names.
export function normalizeName(name) {
  return normalizeText(name).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Lengths (height / spread), returned in cm.

const UNIT = String.raw`(m|metres?|meters?|cm|centimetres?|centimeters?|ft\.?|feet|foot|'|in\.?|inch(?:es)?|")`;
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const FT_IN = String.raw`(\d+(?:[.,]\d+)?)\s*(?:ft\.?|feet|foot|')\s*(\d+(?:[.,]\d+)?)\s*(?:in\.?|inch(?:es)?|")`;

function toNumber(s) {
  return Number(String(s).replace(",", "."));
}

function unitToCm(value, unit) {
  const u = (unit || "").replace(/\.$/, "");
  if (u === "m" || u.startsWith("metre") || u.startsWith("meter")) return value * 100;
  if (u === "cm" || u.startsWith("centimet")) return value;
  if (u === "ft" || u === "feet" || u === "foot" || u === "'") return value * 30.48;
  if (u === "in" || u.startsWith("inch") || u === '"') return value * 2.54;
  return null;
}

const LENGTH_KEYWORDS = {
  height: /(height|hauteur|tall|haut\b|ultimate height)/,
  spread: /(spread|envergure|width|largeur|etalement|diametre|ultimate spread)/,
};

// "6 ft. 0 in. - 12 ft. 0 in." (NC State style) and "3.00 to 6.00 feet",
// "1,5 a 2,5 m", "60 cm", "higher than 12 metres" / "plus de 12 m".
export function parseLength(quote, trait = "height") {
  let t = normalizeText(quote);
  const kw = LENGTH_KEYWORDS[trait];
  if (kw) {
    const m = kw.exec(t);
    if (m) t = t.slice(m.index);
  }

  // feet + inches pairs first (both ends of a range)
  const ftInRange = new RegExp(`${FT_IN}\\s*(?:-|to|a|au|jusqu'a)\\s*${FT_IN}`).exec(t);
  if (ftInRange) {
    const a = toNumber(ftInRange[1]) * 30.48 + toNumber(ftInRange[2]) * 2.54;
    const b = toNumber(ftInRange[3]) * 30.48 + toNumber(ftInRange[4]) * 2.54;
    return orderedRange(a, b);
  }

  const range = new RegExp(`${NUM}\\s*${UNIT}?\\s*(?:-|to|a|au|jusqu'a|et)\\s*${NUM}\\s*${UNIT}`).exec(t);
  if (range) {
    const unitB = range[4];
    const unitA = range[2] || unitB;
    const a = unitToCm(toNumber(range[1]), unitA);
    const b = unitToCm(toNumber(range[3]), unitB);
    if (a == null || b == null) return null;
    return orderedRange(a, b);
  }

  const open = new RegExp(`(higher than|more than|over|greater than|plus de|au-dessus de|superieure? a)\\s*${NUM}\\s*${UNIT}`).exec(t);
  if (open) {
    const v = unitToCm(toNumber(open[2]), open[3]);
    return v == null ? null : { min_cm: roundCm(v), max_cm: null, open_ended: true };
  }

  const single = new RegExp(`${NUM}\\s*${UNIT}`).exec(t);
  if (single) {
    const v = unitToCm(toNumber(single[1]), single[2]);
    return v == null ? null : { min_cm: null, max_cm: roundCm(v), open_ended: false };
  }
  return null;
}

function roundCm(v) {
  return Math.round(v);
}

function orderedRange(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { min_cm: roundCm(lo), max_cm: roundCm(hi), open_ended: false };
}

// ---------------------------------------------------------------------------
// Sun exposure -> subset of SUN_VALUES.

const SUN_PHRASES = [
  ["shade", /(full shade|deep shade|dense shade|heavy shade|ombre dense|ombre totale|pleine ombre|ombre profonde)/g],
  ["bright_shade", /(dappled shade|dappled|light shade|bright shade|ombre legere|ombre claire|lumiere tamisee)/g],
  ["partial_sun", /(partial shade|part shade|partial sun|part sun|semi-shade|semi shade|half shade|partly shaded|mi-ombre|mi ombre|demi-ombre)/g],
  ["full_sun", /(full sun|plein soleil|sunny|ensoleille|soleil)/g],
  ["shade", /\b(shade|shady|ombre)\b/g],
];

export function parseSun(quote) {
  let t = normalizeText(quote);
  const found = new Set();
  for (const [value, re] of SUN_PHRASES) {
    t = t.replace(re, () => {
      found.add(value);
      return " § ";
    });
  }
  const values = SUN_VALUES.filter((v) => found.has(v));
  return values.length ? values : null;
}

// ---------------------------------------------------------------------------
// Plant type -> subset of PLANT_TYPE_VALUES (a source may say "shrub or
// small tree"; agreement is decided on the sets).

const PLANT_TYPE_PHRASES = [
  ["perennial", /\b(herbaceous perennial|perennial|vivace)\b/g],
  ["groundcover", /\b(ground ?cover|couvre-sol|couvre sol)\b/g],
  ["climber", /\b(climber|climbing|vine|liana|grimpante|liane)\b/g],
  // a conifer can be a tree or a shrub: both are returned, the AI proposal
  // and the other sources decide (decide.js requires agreement on one).
  ["conifer", /\b(conifers?|coniferes?|coniferous)\b/g],
  ["tree", /\b(trees?|arbres?)\b/g],
  ["shrub", /\b(shrubs?|arbustes?|arbrisseaux?|arbrisseau|bush)\b/g],
  ["annual", /\b(annual|annuelle)\b/g],
  ["biennial", /\b(biennial|bisannuelle)\b/g],
  ["fern", /\b(ferns?|fougeres?)\b/g],
  ["grass", /\b(ornamental grass|grass|graminee)\b/g],
  ["bulb", /\b(bulbs?|bulbous|bulbes?)\b/g],
];

export function parsePlantType(quote) {
  let t = normalizeText(quote);
  const found = new Set();
  for (const [value, re] of PLANT_TYPE_PHRASES) {
    t = t.replace(re, () => {
      found.add(value);
      return " § ";
    });
  }
  if (found.delete("conifer")) {
    found.add("tree");
    found.add("shrub");
  }
  const values = PLANT_TYPE_VALUES.filter((v) => found.has(v));
  return values.length ? values : null;
}

// ---------------------------------------------------------------------------
// Evergreen -> boolean, or null when absent/ambiguous (semi-evergreen, both).

export function parseEvergreen(quote) {
  const t = normalizeText(quote);
  if (/(semi-evergreen|semi evergreen|semi-persistant|semi persistant|semi-caduc|marcescent)/.test(t)) return null;
  const ever = /(evergreen|persistant|persistent foliage|feuillage persistant)/.test(t);
  const deci = /(deciduous|caduc|caduque|feuillage caduc)/.test(t);
  if (ever && !deci) return true;
  if (deci && !ever) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Water need -> subset of WATER_NEED_VALUES. "well-drained" alone says
// nothing about quantity and maps to nothing.

const WATER_PHRASES = [
  ["moderate", /(moist but well-drained|moist but well drained|moist, well-drained|moist, well drained|frais mais bien draine)/g],
  ["high", /(constantly moist|consistently moist|wet|boggy|waterlogged|humide|marecageu)/g],
  ["low", /(drought[- ]tolerant|drought|dry|low water|faibles? besoins? en eau|secheresse|\bsec\b|seche)/g],
  ["moderate", /(medium|average|moderate|moist|normal|frais|modere)/g],
  ["high", /\bhigh\b/g],
  ["low", /\blow\b/g],
];

export function parseWaterNeed(quote) {
  let t = normalizeText(quote).replace(/well[- ]drained/g, " ");
  const found = new Set();
  for (const [value, re] of WATER_PHRASES) {
    t = t.replace(re, () => {
      found.add(value);
      return " § ";
    });
  }
  const values = WATER_NEED_VALUES.filter((v) => found.has(v));
  return values.length ? values : null;
}

// ---------------------------------------------------------------------------
// Flowering months -> sorted array of 1..12.

const MONTHS = [
  [1, ["january", "jan", "janvier", "janv"]],
  [2, ["february", "feb", "fevrier", "fevr", "fev"]],
  [3, ["march", "mar", "mars"]],
  [4, ["april", "apr", "avril", "avr"]],
  [5, ["may", "mai"]],
  [6, ["june", "jun", "juin"]],
  [7, ["july", "jul", "juillet", "juil"]],
  [8, ["august", "aug", "aout"]],
  [9, ["september", "sept", "sep", "septembre"]],
  [10, ["october", "oct", "octobre"]],
  [11, ["november", "nov", "novembre"]],
  [12, ["december", "dec", "decembre"]],
];

const SEASONS = [
  [/(early spring|debut (du )?printemps)/, [3, 3]],
  [/(mid[- ]?spring|milieu du printemps)/, [4, 4]],
  [/(late spring|fin (du )?printemps)/, [5, 5]],
  [/(early summer|debut (de l'|d')?ete)/, [6, 6]],
  [/(mid[- ]?summer|milieu de l'ete|plein ete)/, [7, 7]],
  [/(late summer|fin (de l'|d')?ete)/, [8, 8]],
  [/(early (autumn|fall)|debut (de l'|d')?automne)/, [9, 9]],
  [/(mid[- ]?(autumn|fall)|milieu de l'automne)/, [10, 10]],
  [/(late (autumn|fall)|fin (de l'|d')?automne)/, [11, 11]],
  [/(early winter|debut (de l'|d')?hiver)/, [12, 12]],
  [/(late winter|fin (de l'|d')?hiver)/, [2, 2]],
  [/(spring|printemps)/, [3, 5]],
  [/(summer|\bete\b)/, [6, 8]],
  [/(autumn|\bfall\b|automne)/, [9, 11]],
  [/(winter|hiver)/, [12, 2]],
];

const RANGE_CONNECTOR = /^\s*(-|to|through|until|till|a|au|jusqu'a|jusqu'en|-\s*)\s*$/;

function monthItems(text) {
  const items = [];
  let t = text;
  // seasons first (longest phrases first), masked so months inside don't re-match
  for (const [re, [start, end]] of SEASONS) {
    const g = new RegExp(re.source, "g");
    t = t.replace(g, (match, ...rest) => {
      const index = rest[rest.length - 2];
      items.push({ index, length: match.length, start, end });
      return "§".repeat(match.length);
    });
  }
  for (const [month, names] of MONTHS) {
    const re = new RegExp(`\\b(${names.join("|")})\\b\\.?`, "g");
    let m;
    while ((m = re.exec(t)) !== null) items.push({ index: m.index, length: m[0].length, start: month, end: month });
  }
  return items.sort((a, b) => a.index - b.index);
}

function expand(start, end) {
  const out = [];
  let m = start;
  for (let guard = 0; guard < 12; guard += 1) {
    out.push(m);
    if (m === end) break;
    m = (m % 12) + 1;
  }
  return out;
}

export function parseMonths(quote) {
  const text = normalizeText(quote);
  const items = monthItems(text);
  if (items.length === 0) return null;
  const months = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const cur = items[i];
    const next = items[i + 1];
    if (next) {
      const between = text.slice(cur.index + cur.length, next.index);
      if (RANGE_CONNECTOR.test(between)) {
        for (const m of expand(cur.start, next.end)) months.add(m);
        i += 1;
        continue;
      }
    }
    for (const m of expand(cur.start, cur.end)) months.add(m);
  }
  return [...months].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Common name: the candidate must literally appear in the passage.

export function quoteContainsName(quote, name) {
  const q = ` ${normalizeName(quote)} `;
  const n = normalizeName(name);
  return n.length > 0 && q.includes(` ${n} `);
}

// parseTraitValue(trait, quote) — single entry point used by grounding.js.
export function parseTraitValue(trait, quote) {
  switch (trait) {
    case "height":
      return parseLength(quote, "height");
    case "spread":
      return parseLength(quote, "spread");
    case "sun":
      return parseSun(quote);
    case "plant_type":
      return parsePlantType(quote);
    case "evergreen":
      return parseEvergreen(quote);
    case "water_need":
      return parseWaterNeed(quote);
    case "flowering_months":
      return parseMonths(quote);
    default:
      return null;
  }
}
