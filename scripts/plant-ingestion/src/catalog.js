import { slugify } from "./refs.js";

// buildSpeciesCatalogEntry / buildCultivarCatalogEntry — pure. Both entries
// of a dry-run batch always come out `publication_status: "draft"` and
// `review_status: "unreviewed"` — nothing is ever auto-published (spec §14).
// The cultivar entry always shares the SAME taxon_ref as its species (spec
// §6) — it is passed in, never re-derived independently, so there is no way
// for the two to accidentally diverge. `catalogRef`/`parentCatalogRef` are
// computed once by the caller (bundle.js) from the input name, deterministic
// regardless of whether WCVP resolution succeeded — see refs.js.

export function buildSpeciesCatalogEntry({ catalogRef, wcvpTaxonRef, canonicalName }) {
  return {
    catalog_ref: catalogRef,
    taxon_ref: wcvpTaxonRef,
    parent_catalog_ref: null,
    entry_type: "species",
    cultivar_name: null,
    display_name: canonicalName,
    common_name: null,
    slug: slugify(canonicalName),
    publication_status: "draft",
    review_status: "unreviewed",
    published_at: null,
    // Explicitly null, not omitted: the USDA hardiness crosswalk does not
    // exist yet, so nothing is ever auto-selected into these two columns
    // (spec §12) — this makes that a visible decision, not a silent gap.
    hardiness_min_rank: null,
    hardiness_max_rank: null,
  };
}

export function buildCultivarCatalogEntry({ catalogRef, wcvpTaxonRef, canonicalName, cultivarName, parentCatalogRef }) {
  const displayName = `${canonicalName} '${cultivarName}'`;
  return {
    catalog_ref: catalogRef,
    taxon_ref: wcvpTaxonRef,
    parent_catalog_ref: parentCatalogRef,
    entry_type: "cultivar",
    cultivar_name: cultivarName,
    display_name: displayName,
    common_name: null,
    slug: slugify(displayName),
    publication_status: "draft",
    review_status: "unreviewed",
    published_at: null,
    hardiness_min_rank: null,
    hardiness_max_rank: null,
  };
}
