import { stableEqual } from "../apply/stableEqual.js";

// buildCatalogSlugMap(transactionPlan) -> Map<catalog_ref, slug>
// Pure. Extracts just the (catalog_ref, slug) pairs a full Layer B
// transaction plan's catalog_entries already carry. This is the ONLY way
// this read-only checker can resolve a symbolic catalog_ref to a real
// plant_catalog row: slug is computed from the exact display_name/
// cultivar_name text (src/catalog.js's slugify(canonicalName) /
// slugify(displayName)), which an editorial input never carries and must
// never re-guess or re-derive independently — that would risk silently
// resolving to the WRONG row. Reusing an existing, already-produced
// transaction plan (e.g. from `npm run plant:ingestion:plan`) is the
// faithful way to obtain this mapping without inventing new state.
export function buildCatalogSlugMap(transactionPlan) {
  const map = new Map();
  for (const c of transactionPlan?.catalog_entries || []) {
    if (c.catalog_ref && c.slug) map.set(c.catalog_ref, c.slug);
  }
  return map;
}

// checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef }) -> checks[]
// Read-only. Never writes, never calls .insert()/.update() on anything.
// For every editorial observation in `plan`, reports:
//   - whether its catalog_ref resolves to a real, existing plant_catalog
//     row (via catalogSlugByRef, see buildCatalogSlugMap above)
//   - whether an editorial observation for the same (catalog, trait)
//     already exists in the DB, and if so whether its raw_value already
//     matches (a future apply would be a no-op) or genuinely differs (a
//     real conflict a human must look at before curating another one)
//   - whether a plant_trait_selections row already exists for this
//     (catalog, trait), and if so whether it is already a protected
//     manual_resolution (must never be silently replaced — surfaced as a
//     conflict, never auto-resolved) or an automatic one (informational:
//     a future apply would supersede it, same as any provider selection)
// Each result: { catalog_ref, trait, ok, code, message }. ok=false marks
// something a human must look at before any future --apply; ok=true marks
// either "would be created cleanly" or "already exists identically".
export async function checkEditorialPlanAgainstDb({ client, plan, catalogSlugByRef }) {
  const results = [];

  for (const obs of plan.editorial_observations) {
    const slug = catalogSlugByRef.get(obs.catalog_ref);
    if (!slug) {
      results.push({
        catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "CATALOG_REF_UNKNOWN",
        message: `no slug known for "${obs.catalog_ref}" — pass --catalog-map with a transaction plan that includes this catalog entry`,
      });
      continue;
    }

    const { data: catalogRow, error: catalogError } = await client.from("plant_catalog").select("id").eq("slug", slug).maybeSingle();
    if (catalogError) {
      results.push({ catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "CATALOG_LOOKUP_FAILED", message: catalogError.message });
      continue;
    }
    if (!catalogRow) {
      results.push({
        catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "CATALOG_ENTRY_NOT_FOUND",
        message: `no plant_catalog row for slug "${slug}" — this catalog entry does not exist yet in this environment`,
      });
      continue;
    }
    const catalogId = catalogRow.id;

    const { data: existingObs, error: obsError } = await client
      .from("plant_trait_observations")
      .select("id, raw_value")
      .eq("plant_catalog_id", catalogId)
      .eq("trait", obs.trait)
      .eq("provider", "editorial");
    if (obsError) {
      results.push({ catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "OBSERVATION_LOOKUP_FAILED", message: obsError.message });
    } else {
      const match = (existingObs || []).find((row) => stableEqual(row.raw_value, obs.raw_value));
      if (match) {
        results.push({
          catalog_ref: obs.catalog_ref, trait: obs.trait, ok: true, code: "OBSERVATION_ALREADY_EXISTS_SAME_VALUE",
          message: "an editorial observation with this exact value already exists — would be a no-op",
        });
      } else if ((existingObs || []).length > 0) {
        results.push({
          catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "OBSERVATION_CONFLICT",
          message: `${existingObs.length} existing editorial observation(s) for this trait have a DIFFERENT value — review before creating another`,
        });
      } else {
        results.push({
          catalog_ref: obs.catalog_ref, trait: obs.trait, ok: true, code: "OBSERVATION_WOULD_BE_CREATED",
          message: "no existing editorial observation for this trait — would be created",
        });
      }
    }

    const { data: existingSel, error: selError } = await client
      .from("plant_trait_selections")
      .select("id, decision_method")
      .eq("plant_catalog_id", catalogId)
      .eq("trait", obs.trait)
      .maybeSingle();
    if (selError) {
      results.push({ catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "SELECTION_LOOKUP_FAILED", message: selError.message });
    } else if (existingSel && existingSel.decision_method === "manual_resolution") {
      results.push({
        catalog_ref: obs.catalog_ref, trait: obs.trait, ok: false, code: "SELECTION_MANUAL_RESOLUTION_PROTECTED",
        message: "a manual_resolution selection already exists for this trait — it will NEVER be overwritten automatically; explicit human intervention required",
      });
    } else if (existingSel) {
      results.push({
        catalog_ref: obs.catalog_ref, trait: obs.trait, ok: true, code: "SELECTION_AUTOMATIC_WOULD_BE_SUPERSEDED",
        message: `an automatic selection (decision_method="${existingSel.decision_method}") exists and would be superseded by a future apply`,
      });
    } else {
      results.push({
        catalog_ref: obs.catalog_ref, trait: obs.trait, ok: true, code: "SELECTION_WOULD_BE_CREATED",
        message: "no existing selection for this trait — would be created",
      });
    }
  }

  return results;
}
