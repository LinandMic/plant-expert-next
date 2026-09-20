import { PROMOTABLE_CATALOG_COLUMNS } from "../plan/catalogColumns.js";

// Layer C, table 3: plant_catalog.
//
// Natural key: slug (real unique constraint: plant_catalog_slug_unique).
//
// CRITICAL safety rule: publication_status, review_status and published_at
// are CURATOR-OWNED fields. Layer B's own invariants O/P guarantee every
// plan always carries publication_status="draft" and review_status=
// "unreviewed" for every entry (see src/plan/invariants.js) — a plan can
// never say otherwise. A curator may promote a row to "published"/
// "reviewed" by hand after ingestion (this already happened for the Acer
// pair in production). If an update ever wrote the plan's draft/unreviewed
// values back over an existing row, re-running the SAME plan would silently
// un-publish already-curated entries. So: these 3 fields are only ever set
// on INSERT (first creation), and are NEVER included in an UPDATE — this
// file does not even read them back for the diff comparison.
//
// SECOND CRITICAL safety rule (added after a real production regression on
// Rhododendron simsii): a promotable trait column currently governed by a
// manual_resolution selection (plant_trait_selections.decision_method =
// "manual_resolution") is CURATOR-OWNED too, at the single-column level —
// this file is the ONLY place a provider apply ever writes a trait column
// to plant_catalog, so it is the only place that can (and must) check the
// CURRENT DB state before writing. The provider plan itself was compiled
// by Layer A/B, entirely before any editorial decision could exist, and
// can be re-applied months after a curator has since overridden a trait —
// so the plan is NEVER trusted alone for this: plant_trait_selections is
// re-read fresh, every single call, right before the write decision (spec:
// "un ancien provider plan peut être réappliqué plusieurs mois après").
// Protection is per-trait, never per-row: a manual_resolution on plant_type
// never blocks a genuine provider update to sun/height/spread/etc. And it
// applies unconditionally — a provider-proposed null AND a provider-
// proposed different-but-non-null value are both overridden the same way;
// manual_resolution always wins.
const CATALOG_INGESTION_FIELDS = [
  "display_name", "common_name", "entry_type", "cultivar_name",
  "plant_type", "growth_form", "height_min_cm", "height_max_cm", "spread_max_cm",
  "sun", "hardiness_min_rank", "hardiness_max_rank", "evergreen", "water_need",
  "container_suitable", "edible", "flowering_months",
];

function catalogRowFromPlan(c, taxonId, parentCatalogId) {
  return {
    taxon_id: taxonId,
    parent_catalog_id: parentCatalogId,
    entry_type: c.entry_type,
    cultivar_name: c.cultivar_name ?? null,
    display_name: c.display_name,
    common_name: c.common_name ?? null,
    slug: c.slug,
    plant_type: c.plant_type ?? null,
    growth_form: c.growth_form ?? null,
    height_min_cm: c.height_min_cm ?? null,
    height_max_cm: c.height_max_cm ?? null,
    spread_max_cm: c.spread_max_cm ?? null,
    sun: c.sun ?? null,
    hardiness_min_rank: c.hardiness_min_rank ?? null,
    hardiness_max_rank: c.hardiness_max_rank ?? null,
    evergreen: c.evergreen ?? null,
    water_need: c.water_need ?? null,
    container_suitable: c.container_suitable ?? null,
    edible: c.edible ?? null,
    flowering_months: c.flowering_months ?? null,
  };
}

function ingestionFieldsDiffer(existingRow, planRow) {
  return CATALOG_INGESTION_FIELDS.some((field) => JSON.stringify(existingRow[field] ?? null) !== JSON.stringify(planRow[field] ?? null));
}

// Species entries have no parent and must be processed (and resolved)
// before any cultivar that references them, regardless of the plan array's
// own order — the compiler already orders this way (see plan/compiler.js),
// this is defense-in-depth, not a correction of a normally-ordered plan.
function orderSpeciesBeforeCultivars(catalogEntries) {
  const species = catalogEntries.filter((c) => c.entry_type === "species");
  const cultivars = catalogEntries.filter((c) => c.entry_type !== "species");
  return [...species, ...cultivars];
}

// fetchManualResolutionTraits({ client, catalogId }) -> { traits } | { error }
// Read-only. The single source of truth for "which trait columns are
// currently curator-owned" on this catalog row — always the live DB,
// queried fresh on every call, never inferred from the plan.
async function fetchManualResolutionTraits({ client, catalogId }) {
  const { data, error } = await client
    .from("plant_trait_selections")
    .select("trait")
    .eq("plant_catalog_id", catalogId)
    .eq("decision_method", "manual_resolution");
  if (error) return { error };
  return { traits: new Set((data || []).map((r) => r.trait)) };
}

// applyManualResolutionProtection(row, existing, protectedTraits, catalogRef)
//   -> { row, protectedFields }
// Pure. For every trait currently under manual_resolution, the EXISTING DB
// value wins over the plan's proposed value in `row` — never the reverse.
// Only PROMOTABLE_CATALOG_COLUMNS are ever substituted: display_name/
// common_name/entry_type/cultivar_name are catalog identity fields, never
// trait-selection-backed (a plant_trait_selections row cannot reference
// them — see the real FK/CHECK constraints), so this never touches them.
// `protectedFields` lists only the traits that were ACTUALLY going to
// differ (provider proposed something other than what's already there) —
// a protected trait the provider's plan already agreed with isn't reported,
// there was never a conflict to prevent.
function applyManualResolutionProtection(row, existing, protectedTraits, catalogRef) {
  if (protectedTraits.size === 0) return { row, protectedFields: [] };

  const protectedRow = { ...row };
  const protectedFields = [];
  for (const trait of protectedTraits) {
    if (!PROMOTABLE_CATALOG_COLUMNS.has(trait) || !(trait in protectedRow)) continue;
    const providerValue = protectedRow[trait] ?? null;
    const currentValue = existing[trait] ?? null;
    protectedRow[trait] = currentValue;
    if (JSON.stringify(providerValue) !== JSON.stringify(currentValue)) {
      protectedFields.push({ catalog_ref: catalogRef, trait, provider_value: providerValue, current_value: currentValue });
    }
  }
  return { row: protectedRow, protectedFields };
}

// upsertCatalogEntries({ client, catalogEntries, taxonIdByRef, dryRun })
//   -> { idByRef, created, updated, unchanged, errors, protectedFields }
//
// protectedFields is additive to the existing created/updated/unchanged
// row-level counts, never a new bucket of its own — a row whose ONLY
// differing fields were all protected still correctly reports "unchanged"
// (the substituted row has nothing left that differs), and
// protectedFields explains why nothing was written for those specific
// traits. A row with a genuine, non-protected difference alongside a
// protected one still reports "updated" (the real write happens, but only
// for the non-protected fields — see applyManualResolutionProtection).
// This is deliberately never surfaced as its own created/updated/unchanged
// count: the dry-run must never say "updated" for a difference that will
// be ignored at apply time (spec) — protectedFields is the explicit reason
// attached to whatever the row's real, honest status already is.
export async function upsertCatalogEntries({ client, catalogEntries, taxonIdByRef, dryRun }) {
  const idByRef = new Map();
  const errors = [];
  const protectedFields = [];
  let created = 0, updated = 0, unchanged = 0;

  for (const c of orderSpeciesBeforeCultivars(catalogEntries)) {
    const taxonId = taxonIdByRef.get(c.taxon_ref);
    const parentCatalogId = c.parent_catalog_ref ? idByRef.get(c.parent_catalog_ref) ?? null : null;

    if (!taxonId || (c.parent_catalog_ref && !parentCatalogId)) {
      // Parent taxon (or, for a cultivar, parent species) doesn't exist yet
      // — this entry would be created alongside it.
      created += 1;
      idByRef.set(c.catalog_ref, null);
      continue;
    }

    const { data: existing, error: selectError } = await client
      .from("plant_catalog")
      .select(["id", ...CATALOG_INGESTION_FIELDS].join(", "))
      .eq("slug", c.slug)
      .maybeSingle();

    if (selectError) {
      errors.push(`plant_catalog lookup failed for slug "${c.slug}": ${selectError.message}`);
      idByRef.set(c.catalog_ref, null);
      continue;
    }

    let row = catalogRowFromPlan(c, taxonId, parentCatalogId);

    if (!existing) {
      // A brand-new row can never have a manual_resolution yet (nothing to
      // protect against) — no lookup needed.
      created += 1;
      if (dryRun) {
        idByRef.set(c.catalog_ref, null);
        continue;
      }
      // Only on first creation: publication_status/review_status/published_at
      // take the plan's values (always draft/unreviewed/null per invariants O/P).
      const insertRow = { ...row, publication_status: c.publication_status, review_status: c.review_status, published_at: c.published_at ?? null };
      const { data: inserted, error: insertError } = await client.from("plant_catalog").insert(insertRow).select("id").single();
      if (insertError) {
        errors.push(`plant_catalog insert failed for slug "${c.slug}": ${insertError.message}`);
        idByRef.set(c.catalog_ref, null);
        continue;
      }
      idByRef.set(c.catalog_ref, inserted.id);
      continue;
    }

    idByRef.set(c.catalog_ref, existing.id);

    const { traits: manualResolutionTraits, error: selError } = await fetchManualResolutionTraits({ client, catalogId: existing.id });
    if (selError) {
      // Never guess whether a field is protected when the check itself
      // failed — refuse to write this row rather than risk silently
      // overwriting a curator decision this lookup couldn't confirm.
      errors.push(`plant_trait_selections lookup failed while checking manual_resolution protection for slug "${c.slug}": ${selError.message}`);
      continue;
    }
    const protection = applyManualResolutionProtection(row, existing, manualResolutionTraits, c.catalog_ref);
    row = protection.row;
    protectedFields.push(...protection.protectedFields);

    if (!ingestionFieldsDiffer(existing, row)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (dryRun) continue;
    // Deliberately excludes publication_status/review_status/published_at —
    // see the file-level comment above.
    const { error: updateError } = await client.from("plant_catalog").update(row).eq("id", existing.id);
    if (updateError) errors.push(`plant_catalog update failed for slug "${c.slug}": ${updateError.message}`);
  }

  return { idByRef, created, updated, unchanged, errors, protectedFields };
}
