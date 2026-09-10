import Head from "next/head";
import { useEffect } from "react";
import "@/styles/globals.css";
import "@/styles/ui-shell.css";

// Registers the PWA service worker once the page has fully loaded, so it
// never competes with initial page load. Installability/offline support is
// a progressive enhancement: unsupported browsers (no navigator.serviceWorker)
// and a failed registration are both silently no-ops — the app itself must
// never depend on this succeeding.
function useServiceWorker() {
  useEffect(() => {
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

export default function App({ Component, pageProps }) {
  useServiceWorker();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f9f6ef" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Herbiose" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
