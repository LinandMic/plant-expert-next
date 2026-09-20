import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isSupportedLocale,
  detectBrowserLocale,
  getStoredLocale,
  persistLocale,
  resolveInitialClientLocale,
  translate,
  createTranslator,
} from "./core.js";

// Lightweight internal i18n layer (round 1: UI strings only, never plant
// data/traits coming from Supabase — those stay exactly as fetched). No
// external dependency: a plain nested-object dictionary per locale + a
// dot-path lookup, which is all this app needs today.
//
// The pure logic (dictionaries, detection, persistence, dot-path lookup)
// lives in ./core.js, which has zero React/JSX — this file only adds the
// Context/Provider/hook on top of it. Kept separate so a plain Node runtime
// with no JSX transform (e.g. `node --test`) can still import the pure
// logic directly — see lib/plantFinderFormat.test.js and
// lib/plantFinderFilters.test.js, which use createTranslator from ./core.js.

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, detectBrowserLocale, getStoredLocale, createTranslator };

// useIsomorphicLayoutEffect: useLayoutEffect on the client (fires
// synchronously before paint, so a locale correction from localStorage/
// browser detection is applied before the user sees anything), plain
// useEffect on the server (useLayoutEffect would warn during SSR — the
// effect itself never runs there either way, since resolveInitialClientLocale()
// is only ever called client-side).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const I18nContext = createContext(null);

// I18nProvider — mounted once in pages/_app.js so every page/component has
// access to useI18n(). Always renders DEFAULT_LOCALE ("fr") on the very
// first render, server AND client, so hydration never mismatches; the
// real locale (stored choice, or browser-detected) is resolved in a
// layout effect that runs strictly after mount, which is a normal
// client-side re-render, never a hydration diff.
export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  useIsomorphicLayoutEffect(() => {
    const resolved = resolveInitialClientLocale();
    if (resolved !== locale) setLocaleState(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (next) => {
    if (!isSupportedLocale(next) || next === locale) return;
    setLocaleState(next);
    persistLocale(next);
  };

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// useI18n() -> { locale, setLocale, t }
// Throws loudly if used outside I18nProvider — a silent fallback here
// would risk shipping untranslated/default-only text without anyone
// noticing, exactly the kind of gap this round exists to close.
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n() must be used within an I18nProvider");
  return ctx;
}
