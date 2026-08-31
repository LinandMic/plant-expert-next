// Post-apply (or standalone) verification: for every row a plan describes,
// confirm it really exists in the DB, exactly once, wired to the right
// parent via FK — independent of whatever applyPlan() itself just reported,
// so a bug in the upsert bookkeeping can't silently mark itself "ok". Read
// only: verifyPlan never writes anything.
import { guardPlan } from "./planGuard.js";
import { stableEqual } from "./stableEqual.js";

function addCheck(checks, ok, message) {
  checks.push({ ok, message });
  return ok;
}

// verifyPlan({ client, plan }) -> { ok, checks, summary }
export async function verifyPlan({ client, plan }) {
  const checks = [];
  const guardErrors = guardPlan(plan);
  if (guardErrors.length > 0) {
    return { ok: false, checks: guardErrors.map((message) => ({ ok: false, message })), summary: null };
  }

  const taxonIdByRef = new Map();
  for (const t of plan.taxa) {
    const { data, error } = await client.from("plant_taxa").select("id").eq("wcvp_taxon_id", t.wcvp_taxon_id);
    if (error) {
      addCheck(checks, false, `plant_taxa lookup failed for ${t.taxon_ref}: ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) {
      addCheck(checks, false, `plant_taxa: no row for ${t.taxon_ref} (wcvp_taxon_id=${t.wcvp_taxon_id})`);
      continue;
    }
    if (data.length > 1) {
      addCheck(checks, false, `plant_taxa: ${data.length} duplicate rows for wcvp_taxon_id=${t.wcvp_taxon_id} (expected exactly 1)`);
      continue;
    }
    taxonIdByRef.set(t.taxon_ref, data[0].id);
    addCheck(checks, true, `plant_taxa: ${t.taxon_ref} exists exactly once`);
  }

  for (const n of plan.taxon_names) {
    const taxonId = taxonIdByRef.get(n.taxon_ref);
    if (!taxonId) {
      addCheck(checks, false, `plant_taxon_names: cannot verify "${n.normalized_name}", parent taxon ${n.taxon_ref} missing`);
      continue;
    }
    const { data, error } = await client.from("plant_taxon_names").select("id").eq("taxon_id", taxonId).eq("normalized_name", n.normalized_name);
    if (error) {
      addCheck(checks, false, `plant_taxon_names lookup failed for "${n.normalized_name}": ${error.message}`);
      continue;
    }
    if (!data || data.length !== 1) {
      addCheck(checks, false, `plant_taxon_names: expected exactly 1 row for "${n.normalized_name}" under ${n.taxon_ref}, found ${data?.length ?? 0}`);
      continue;
    }
    addCheck(checks, true, `plant_taxon_names: "${n.normalized_name}" exists exactly once`);
  }

  const catalogIdByRef = new Map();
  for (const c of plan.catalog_entries) {
    const taxonId = taxonIdByRef.get(c.taxon_ref);
    const { data, error } = await client.from("plant_catalog").select("id, taxon_id, parent_catalog_id").eq("slug", c.slug);
    if (error) {
      addCheck(checks, false, `plant_catalog lookup failed for slug "${c.slug}": ${error.message}`);
      continue;
    }
    if (!data || data.length !== 1) {
      addCheck(checks, false, `plant_catalog: expected exactly 1 row for slug "${c.slug}", found ${data?.length ?? 0}`);
      continue;
    }
    const row = data[0];
    catalogIdByRef.set(c.catalog_ref, row.id);
    if (taxonId && row.taxon_id !== taxonId) {
      addCheck(checks, false, `plant_catalog: slug "${c.slug}" is linked to the wrong taxon (FK coherence failure)`);
      continue;
    }
    if (c.parent_catalog_ref) {
      const expectedParentId = catalogIdByRef.get(c.parent_catalog_ref);
      if (expectedParentId && row.parent_catalog_id !== expectedParentId) {
        addCheck(checks, false, `plant_catalog: slug "${c.slug}" parent_catalog_id does not match ${c.parent_catalog_ref} (FK coherence failure)`);
        continue;
      }
    }
    addCheck(checks, true, `plant_catalog: slug "${c.slug}" exists exactly once, FK-coherent`);
  }

  for (const s of plan.source_records) {
    const catalogId = catalogIdByRef.get(s.catalog_ref);
    if (!catalogId) {
      addCheck(checks, false, `plant_source_records: cannot verify ${s.source_record_ref}, parent catalog ${s.catalog_ref} missing`);
      continue;
    }
    const { data, error } = await client
      .from("plant_source_records")
      .select("id")
      .eq("plant_catalog_id", catalogId)
      .eq("provider", s.provider)
      .is("superseded_at", null);
    if (error) {
      addCheck(checks, false, `plant_source_records lookup failed for ${s.source_record_ref}: ${error.message}`);
      continue;
    }
    if (!data || data.length !== 1) {
      addCheck(checks, false, `plant_source_records: expected exactly 1 current row for ${s.source_record_ref}, found ${data?.length ?? 0}`);
      continue;
    }
    addCheck(checks, true, `plant_source_records: ${s.source_record_ref} has exactly 1 current row`);
  }

  const observationIdByRef = new Map();
  for (const o of plan.trait_observations) {
    const catalogId = catalogIdByRef.get(o.catalog_ref);
    if (!catalogId) {
      addCheck(checks, false, `plant_trait_observations: cannot verify ${o.observation_ref}, parent catalog ${o.catalog_ref} missing`);
      continue;
    }
    const { data, error } = await client
      .from("plant_trait_observations")
      .select("id, raw_value")
      .eq("plant_catalog_id", catalogId)
      .eq("trait", o.trait)
      .eq("provider", o.provider);
    if (error) {
      addCheck(checks, false, `plant_trait_observations lookup failed for ${o.observation_ref}: ${error.message}`);
      continue;
    }
    const match = (data ?? []).find((row) => stableEqual(row.raw_value, o.raw_value));
    if (!match) {
      addCheck(checks, false, `plant_trait_observations: no matching row found for ${o.observation_ref} (trait=${o.trait}, provider=${o.provider})`);
      continue;
    }
    observationIdByRef.set(o.observation_ref, match.id);
    addCheck(checks, true, `plant_trait_observations: ${o.observation_ref} exists`);
  }

  for (const sel of plan.trait_selections) {
    const catalogId = catalogIdByRef.get(sel.catalog_ref);
    if (!catalogId) {
      addCheck(checks, false, `plant_trait_selections: cannot verify ${sel.catalog_ref}/${sel.trait}, parent catalog missing`);
      continue;
    }
    const { data, error } = await client.from("plant_trait_selections").select("id, selected_observation_id").eq("plant_catalog_id", catalogId).eq("trait", sel.trait);
    if (error) {
      addCheck(checks, false, `plant_trait_selections lookup failed for ${sel.catalog_ref}/${sel.trait}: ${error.message}`);
      continue;
    }
    if (!data || data.length !== 1) {
      addCheck(checks, false, `plant_trait_selections: expected exactly 1 row for ${sel.catalog_ref}/${sel.trait}, found ${data?.length ?? 0}`);
      continue;
    }
    // Not compared against observationIdByRef: a curator's manual_resolution
    // may legitimately point at a different observation than the plan's own
    // recommendation — that divergence is expected, not a failure.
    addCheck(checks, true, `plant_trait_selections: ${sel.catalog_ref}/${sel.trait} exists exactly once`);
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
  };
}
