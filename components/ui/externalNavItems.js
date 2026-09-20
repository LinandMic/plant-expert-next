import { IconHome, IconCamera, IconSprout, IconSearch, IconUser } from "@/components/ui/icons";

// Shared navItems for every standalone route outside of pages/index.js
// (Plant Finder's list + detail pages today, and any future one). Accueil,
// Identifier and Mon jardin are tabs that only ever exist inside "/" — they
// have no route of their own — so they link to "/" using the same ?tab=
// query pages/index.js itself reads and writes (see its tabFromQuery()
// helper and the URL<->tab sync effects in Home()). A single shared array
// is what keeps a standalone page's nav from silently drifting out of sync
// with "/" — each of these previously duplicated the same array by hand,
// which is exactly how they drifted (Phase 4.1: two of the three links here
// pointed at "/" instead of the real tab, so they always landed on Accueil).
//
// getExternalNavItems(t): a function, not a constant, since the labels must
// reflect the active locale — t comes from useI18n() at each call site.
export function getExternalNavItems(t) {
  return [
    { key: "accueil", label: t("nav.accueil"), icon: IconHome, kind: "link", href: "/", placement: "main" },
    { key: "identifier", label: t("nav.identifier"), icon: IconCamera, kind: "link", href: "/?tab=identifier", placement: "main", emphasis: true },
    { key: "jardin", label: t("nav.jardin"), icon: IconSprout, kind: "link", href: "/?tab=jardin", placement: "main" },
    { key: "trouver", label: t("nav.trouver"), icon: IconSearch, kind: "link", href: "/plant-finder", placement: "main" },
    { key: "profil", label: t("nav.profil"), icon: IconUser, kind: "link", href: "/profile", placement: "bottom" },
  ];
}
