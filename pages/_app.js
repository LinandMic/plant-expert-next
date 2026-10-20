import Head from "next/head";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { I18nProvider } from "@/lib/i18n";
import { isNativePlatform, getWebOrigin } from "@/lib/platform";
import { initNativeDeepLinks } from "@/lib/nativeDeepLink";
import { getKnownRoutes, installNativeLinkRouting, resolveColdStartPath } from "@/lib/nativeNavigation";
import "@/styles/fonts.css";
import "@/styles/globals.css";
import "@/styles/ui-shell.css";

// Registers the PWA service worker once the page has fully loaded, so it
// never competes with initial page load. Installability/offline support is
// a progressive enhancement: unsupported browsers (no navigator.serviceWorker)
// and a failed registration are both silently no-ops — the app itself must
// never depend on this succeeding.
//
// Never registered inside a native Capacitor shell: there is no service
// worker use case there (no browser install prompt, no offline caching of
// a remote origin — the native shell already ships the whole app locally),
// and registering one against the local WebView origin would be at best
// inert and at worst a confusing extra cache layer on top of the native
// static export.
function useServiceWorker() {
  useEffect(() => {
    if (isNativePlatform()) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    // This effect can run after the browser's own `load` event already
    // fired (hydration frequently lands after it) — a plain
    // addEventListener("load", ...) would then silently never call back,
    // and the SW would never register. document.readyState === "complete"
    // is the reliable signal that `load` has already happened.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);
}

// Native only: plain <a href> page links become client-side navigations,
// and a cold start/reload that landed on a non-root route (Capacitor
// served index.html as the fallback) is corrected once to the real page.
// See lib/nativeNavigation.js. The web build never installs any of this.
function useNativeNavigation() {
  const router = useRouter();
  useEffect(() => {
    if (!isNativePlatform()) return;
    return installNativeLinkRouting(router);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isNativePlatform() || !router.isReady) return;
    const path = resolveColdStartPath({
      routerPathname: router.pathname,
      location: window.location,
      knownRoutes: getKnownRoutes(),
    });
    if (path) router.replace(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);
}

export default function App({ Component, pageProps }) {
  useServiceWorker();
  useNativeNavigation();
  useEffect(() => {
    initNativeDeepLinks(getWebOrigin());
  }, []);

  return (
    <>
      <Head>
        <title>Almeo — Your green expert</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f9f6ef" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Almeo" />
      </Head>
      <I18nProvider>
        <Component {...pageProps} />
      </I18nProvider>
    </>
  );
}
