// Pure (non-React) i18n core: locale detection/persistence and the
// dot-path dictionary lookup. Deliberately has zero React/JSX in this file
// — lib/i18n/index.js wraps it with the Context/Provider/hook, but plain
// Node (e.g. `node --test`, which has no JSX transform) can import this
// module directly, which is why lib/plantFinderFormat.test.js and
// lib/plantFinderFilters.test.js pull createTranslator from here rather
// than from lib/i18n/index.js.

import fr from "./locales/fr.js";
import en from "./locales/en.js";

export const SUPPORTED_LOCALES = ["fr", "en"];
export const DEFAULT_LOCALE = "fr"; // spec: "fallback = fr"
export const LOCALE_STORAGE_KEY = "herbiose_locale";

const DICTIONARIES = { fr, en };

export function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.includes(value);
}

// detectBrowserLocale() -> "fr" | "en"
// Spec: "fr si navigateur francophone, en sinon" — checked against every
// language in navigator.languages (falling back to navigator.language),
// in the browser's own preference order, so a browser listing
// ["en-US","fr-FR"] is genuinely English-first, not just "fr appears
// somewhere". Server-side (no navigator) resolves to DEFAULT_LOCALE.
export function detectBrowserLocale() {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const lang of langs) {
    if (typeof lang === "string" && lang.toLowerCase().startsWith("fr")) return "fr";
  }
  return "en";
}

// getStoredLocale() -> "fr" | "en" | null
// null means "no manual choice recorded" (never a fabricated locale) —
// the caller decides what to do with that (fall back to browser
// detection). Never throws: localStorage can be unavailable (private
// browsing, disabled storage) or contain unrelated/corrupted data.
export function getStoredLocale() {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function persistLocale(locale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable — the in-memory locale for this session still
    // works, it just won't survive a reload. Never a crash.
  }
}

// resolveInitialClientLocale() -> "fr" | "en"
// Manual choice (localStorage) always wins over browser detection —
// spec: "mémoriser le choix manuel de l'utilisateur localement" implies
// that choice is authoritative once made.
export function resolveInitialClientLocale() {
  return getStoredLocale() || detectBrowserLocale();
}

// t(dictionary, key, vars) -> string
// Dot-path lookup ("finder.title") into a nested locale dictionary.
// Missing in the active locale -> falls back to the fr dictionary (never
// English silently substituted for a French-only reader) -> missing
// there too -> the key itself, so a UI never renders blank/undefined
// text, only a visibly-wrong string an engineer will immediately notice.
function lookup(dictionary, key) {
  return key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), dictionary);
}

export function translate(locale, key, vars) {
  let value = lookup(DICTIONARIES[locale], key);
  if (value === undefined) value = lookup(DICTIONARIES[DEFAULT_LOCALE], key);
  if (value === undefined) return key;
  if (vars) {
    return Object.keys(vars).reduce((str, varName) => str.replace(`{${varName}}`, vars[varName]), value);
  }
  return value;
}

// createTranslator(locale) -> t(key, vars)
// The same lookup/fallback/interpolation logic useI18n().t uses, exposed as
// a plain function for call sites that need a translator without a React
// tree (e.g. unit tests for lib/plantFinderFormat.js, lib/plantFinderFilters.js).
export function createTranslator(locale) {
  const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return (key, vars) => translate(resolvedLocale, key, vars);
}
