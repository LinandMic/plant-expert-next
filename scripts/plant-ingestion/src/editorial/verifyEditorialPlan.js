import { stableEqual } from "../apply/stableEqual.js";

function addCheck(checks, ok, message) {
  checks.push({ ok, message });
  return ok;
}

// verifyEditorialPlan({ client, plan, catalogSlugByRef, expectedPublicationStatusByCatalogRef })
//   -> { ok, checks, summary }
// Read-only — never writes anything. Independent of applyEditorialPlan()'s
// own bookkeeping, the same way apply/verifyPlan.js is independent of
// applyPlan()'s: a bug in the apply report can never silently mark itself
// "ok" here.
//
// `expectedPublicationStatusByCatalogRef` is optional (Map<catalog_ref,
// publication_status>). When the caller captured each catalog entry's
// publication_status BEFORE running applyEditorialPlan(), passing it here
// lets this function genuinely PROVE it is unchanged (a real equality
// check). Without it, this function only reports the current value
// informationally — it is never fabricated as "unchanged" without real
// before/after evidence. Either way, promoteCatalogTrait() is structurally
// incapable of writing this column (see its own file comment) — this
// check exists to catch a regression in that guarantee, not because the
// guarantee is in doubt today.
export async function verifyEditorialPlan({ client, plan, catalogSlugByRef, expectedPublicationStatusByCatalogRef = null }) {
  const checks = [];

  for (const observation of plan.editorial_observations) {
    const label = `${observation.catalog_ref}/${observation.trait}`;
    const slug = catalogSlugByRef.get(observation.catalog_ref);
    if (!slug) {
      addCheck(checks, false, `${label}: no slug known — cannot verify (pass --catalog-map)`);
      continue;
    }

    const { data: catalogRow, error: catalogError } = await client
      .from("plant_catalog")
      .select(`id, publication_status, ${observation.trait}`)
      .eq("slug", slug)
      .maybeSingle();
    if (catalogError) {
      addCheck(checks, false, `${label}: plant_catalog lookup failed: ${catalogError.message}`);
      continue;
    }
    if (!catalogRow) {
      addCheck(checks, false, `${label}: no plant_catalog row for slug "${slug}"`);
      continue;
    }

    const { data: obsRows, error: obsError } = await client
      .from("plant_trait_observations")
      .select("id, normalized_value, review_status, curation_method, curation_license, license")
      .eq("plant_catalog_id", catalogRow.id)
      .eq("trait", observation.trait)
      .eq("provider", "editorial");
    if (obsError) {
      addCheck(checks, false, `${label}: plant_trait_observations lookup failed: ${obsError.message}`);
      continue;
    }
    const match = (obsRows || []).find((row) => stableEqual(row.normalized_value, observation.normalized_value));
    if (!match) {
      addCheck(checks, false, `${label}: no editorial observation found with a matching normalized_value`);
      continue;
    }
    addCheck(checks, true, `${label}: editorial observation exists with matching normalized_value`);
    addCheck(checks, match.review_status === "accepted", `${label}: observation review_status is "${match.review_status}" (expected "accepted")`);
    // Provenance duality (spec: curation_license must never mask source
    // license) — verified as two INDEPENDENT equalities, never compared
    // against each other, so a future regression that collapses the two
    // into one value is caught here.
    addCheck(checks, match.curation_method === observation.curation_method, `${label}: curation_method is "${match.curation_method}" (expected "${observation.curation_method}")`);
    addCheck(checks, stableEqual(match.curation_license ?? null, observation.curation_license ?? null), `${label}: curation_license matches the plan`);
    addCheck(checks, stableEqual(match.license ?? null, observation.license ?? null), `${label}: source license matches the plan (independent of curation_license)`);

    const { data: selRow, error: selError } = await client
      .from("plant_trait_selections")
      .select("id, decision_method, selected_observation_id")
      .eq("plant_catalog_id", catalogRow.id)
      .eq("trait", observation.trait)
      .maybeSingle();
    if (selError) {
      addCheck(checks, false, `${label}: plant_trait_selections lookup failed: ${selError.message}`);
      continue;
    }
    if (!selRow) {
      addCheck(checks, false, `${label}: no selection found`);
      continue;
    }
    addCheck(checks, selRow.decision_method === "manual_resolution", `${label}: selection decision_method is "${selRow.decision_method}" (expected "manual_resolution")`);
    addCheck(checks, selRow.selected_observation_id === match.id, `${label}: selection points at the matching editorial observation`);

    addCheck(checks, stableEqual(catalogRow[observation.trait] ?? null, observation.normalized_value), `${label}: plant_catalog.${observation.trait} matches the selected normalized_value`);

    if (expectedPublicationStatusByCatalogRef && expectedPublicationStatusByCatalogRef.has(observation.catalog_ref)) {
      const expected = expectedPublicationStatusByCatalogRef.get(observation.catalog_ref);
      addCheck(checks, catalogRow.publication_status === expected, `${label}: plant_catalog.publication_status is still "${catalogRow.publication_status}" (expected unchanged from "${expected}")`);
    } else {
      addCheck(checks, true, `${label}: plant_catalog.publication_status = "${catalogRow.publication_status}" (informational — no before-snapshot was provided to compare against)`);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  };
}
