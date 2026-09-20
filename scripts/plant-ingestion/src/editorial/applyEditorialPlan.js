import { stableEqual } from "../apply/stableEqual.js";
import { upsertObservations } from "../apply/upsertObservations.js";
import { upsertSelections } from "../apply/upsertSelections.js";
import { guardEditorialPlan } from "./buildEditorialPlan.js";
import { promoteCatalogTrait } from "./promoteCatalogTrait.js";

// resolveCatalogId({ client, slug }) -> { id } | { error }
// Read-only. Never creates a plant_catalog row — the editorial overlay
// only ever targets a catalog entry that already exists (spec: "vérifier
// que chaque catalog_ref existe déjà").
async function resolveCatalogId({ client, slug }) {
  const { data, error } = await client.from("plant_catalog").select("id").eq("slug", slug).maybeSingle();
  if (error) return { error: `plant_catalog lookup failed for slug "${slug}": ${error.message}` };
  if (!data) return { error: `no plant_catalog row for slug "${slug}" — this catalog entry does not exist yet in this environment` };
  return { id: data.id };
}

// checkExistingManualResolution({ client, catalogId, trait, proposedNormalizedValue })
//   -> { exists: false } | { exists: true, sameValue: boolean }
// Read-only. This is the A/B distinction spec §5 asks for, sharper than
// upsertSelections.js's own protection (which correctly refuses to ever
// touch an existing manual_resolution row, but reports it "unchanged"
// whether or not the plan's proposal actually agrees with it). Fetches the
// EXISTING selected observation's normalized_value (not just its id) so a
// re-curation that produces a NEW observation row with the SAME value as
// an old manual_resolution's observation is correctly treated as "unchanged"
// too — the comparison is by value, never merely by observation identity.
async function checkExistingManualResolution({ client, catalogId, trait, proposedNormalizedValue }) {
  const { data: existingSel, error: selError } = await client
    .from("plant_trait_selections")
    .select("id, decision_method, selected_observation_id")
    .eq("plant_catalog_id", catalogId)
    .eq("trait", trait)
    .maybeSingle();
  if (selError) return { error: `plant_trait_selections lookup failed for catalog ${catalogId}/${trait}: ${selError.message}` };
  if (!existingSel || existingSel.decision_method !== "manual_resolution") return { exists: false };

  const { data: existingObs, error: obsError } = await client
    .from("plant_trait_observations")
    .select("id, normalized_value")
    .eq("id", existingSel.selected_observation_id)
    .maybeSingle();
  if (obsError) return { error: `plant_trait_observations lookup failed for id ${existingSel.selected_observation_id}: ${obsError.message}` };
  if (!existingObs) return { error: `manual_resolution at catalog ${catalogId}/${trait} points to a missing observation ${existingSel.selected_observation_id}` };

  return { exists: true, sameValue: stableEqual(existingObs.normalized_value, proposedNormalizedValue) };
}

function emptyEntryResult(catalogRef, trait) {
  return { catalog_ref: catalogRef, trait, observation: null, selection: null, promotion: null, errors: [] };
}

// applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun }) -> report
//
// Per-entry pipeline (never table-batched like apply/applyPlan.js — each
// (catalog_ref, trait) pair in an editorial plan is independent of every
// other pair, so one entry's failure never blocks another's):
//   1. resolve catalog_ref -> plant_catalog.id (never creates one)
//   2. upsert the editorial observation — reuses apply/upsertObservations.js
//      UNCHANGED (it already special-cases provider="editorial": no
//      source_record lookup, plant_source_record_id stays null)
//   3. check for an existing PROTECTED manual_resolution — same value =>
//      proceed (idempotent), different value => CONFLICT, stop this entry
//      here, no selection write attempted, no promotion
//   4. upsert the manual_resolution selection — reuses
//      apply/upsertSelections.js UNCHANGED (its own anti-clobber
//      protection is real defense-in-depth on top of step 3, not the only
//      line of defense)
//   5. promote normalized_value into the single plant_catalog[trait]
//      column — ONLY if steps 2 and 4 both succeeded and step 3 found no
//      conflict (spec §4/§6: an observation failure blocks the selection
//      AND the promotion; a selection failure blocks only the promotion)
// dryRun=true (the default) performs every read above for an accurate
// preview but never calls .insert()/.update() anywhere — mirrors
// apply/applyPlan.js's own dry-run contract exactly.
export async function applyEditorialPlan({ client, plan, catalogSlugByRef, dryRun = true }) {
  const guardErrors = guardEditorialPlan(plan);
  if (guardErrors.length > 0) {
    return { ok: false, dryRun, guardErrors, entries: [], totals: null };
  }

  const selectionByObservationRef = new Map(plan.manual_selections.map((s) => [s.selected_observation_ref, s]));
  const catalogIdCache = new Map(); // catalog_ref -> id, reused across entries sharing the same catalog

  const entries = [];

  for (const observation of plan.editorial_observations) {
    const entry = emptyEntryResult(observation.catalog_ref, observation.trait);
    const selection = selectionByObservationRef.get(observation.observation_ref);

    if (!selection) {
      entry.errors.push(`no manual_selection references observation ${observation.observation_ref}`);
      entries.push(entry);
      continue;
    }

    // Defense-in-depth (spec §4): these are always true for anything
    // produced by buildEditorialPlan(), but a hand-edited or corrupted
    // plan file must never be trusted blindly — same philosophy as
    // guardPlan()/guardEditorialPlan() elsewhere in this pipeline.
    if (observation.catalog_ref !== selection.catalog_ref || observation.trait !== selection.trait) {
      entry.errors.push("observation/selection catalog_ref or trait mismatch — refusing to process this entry");
      entries.push(entry);
      continue;
    }
    if (observation.provider !== "editorial" || observation.source_scope !== "editorial") {
      entry.errors.push('observation is not a genuine editorial observation (provider/source_scope must both be "editorial")');
      entries.push(entry);
      continue;
    }
    if (observation.review_status !== "accepted") {
      entry.errors.push(`observation review_status is "${observation.review_status}", not "accepted" — never promoted`);
      entries.push(entry);
      continue;
    }
    if (selection.decision_method !== "manual_resolution") {
      entry.errors.push(`selection decision_method is "${selection.decision_method}", not "manual_resolution" — never promoted`);
      entries.push(entry);
      continue;
    }

    // 1. resolve catalog_ref -> id
    if (!catalogIdCache.has(observation.catalog_ref)) {
      const slug = catalogSlugByRef.get(observation.catalog_ref);
      if (!slug) {
        catalogIdCache.set(observation.catalog_ref, { error: `no slug known for "${observation.catalog_ref}" — pass --catalog-map with a transaction plan that includes this catalog entry` });
      } else {
        catalogIdCache.set(observation.catalog_ref, await resolveCatalogId({ client, slug }));
      }
    }
    const catalogResolved = catalogIdCache.get(observation.catalog_ref);
    if (catalogResolved.error) {
      entry.errors.push(catalogResolved.error);
      entries.push(entry);
      continue;
    }
    const catalogId = catalogResolved.id;
    const catalogIdByRef = new Map([[observation.catalog_ref, catalogId]]);

    // 2. upsert the editorial observation
    const obsResult = await upsertObservations({
      client,
      observations: [observation],
      catalogIdByRef,
      sourceRecordIdByRef: new Map(), // editorial observations never reference a source_record_ref
      dryRun,
    });
    entry.observation = {
      status: obsResult.failed > 0 ? "failed" : obsResult.created > 0 ? "created" : "unchanged",
      errors: obsResult.errors,
    };
    if (obsResult.failed > 0) {
      entries.push(entry);
      continue; // observation failed -> selection and promotion never attempted
    }
    const observationId = obsResult.idByRef.get(observation.observation_ref) ?? null;

    // 3. check for an existing protected manual_resolution BEFORE writing
    const conflictCheck = await checkExistingManualResolution({ client, catalogId, trait: selection.trait, proposedNormalizedValue: observation.normalized_value });
    if (conflictCheck.error) {
      entry.selection = { status: "failed", errors: [conflictCheck.error] };
      entries.push(entry);
      continue;
    }
    if (conflictCheck.exists && !conflictCheck.sameValue) {
      entry.selection = { status: "conflict", errors: [] };
      entries.push(entry); // no write attempted, no promotion
      continue;
    }

    // 4. upsert the manual_resolution selection
    const observationIdByRef = new Map([[observation.observation_ref, observationId]]);
    const selResult = await upsertSelections({ client, selections: [selection], catalogIdByRef, observationIdByRef, dryRun });
    entry.selection = {
      status: selResult.errors.length > 0 ? "failed" : selResult.created > 0 ? "created" : selResult.updated > 0 ? "updated" : "unchanged",
      errors: selResult.errors,
    };
    if (selResult.errors.length > 0) {
      entries.push(entry);
      continue; // selection failed -> promotion never attempted
    }

    // 5. promote normalized_value into plant_catalog[trait]
    const promotion = await promoteCatalogTrait({ client, catalogId, trait: selection.trait, normalizedValue: observation.normalized_value, dryRun });
    entry.promotion = promotion.status === "failed" ? { status: "failed", errors: [promotion.error] } : { status: promotion.status, errors: [] };

    entries.push(entry);
  }

  const totals = {
    editorial_observations: { created: 0, unchanged: 0, failed: 0 },
    manual_selections: { created: 0, updated: 0, unchanged: 0, conflicts: 0, failed: 0 },
    catalog_promotions: { updated: 0, unchanged: 0, skipped: 0, failed: 0 },
  };
  for (const entry of entries) {
    if (entry.observation) totals.editorial_observations[entry.observation.status] += 1;
    if (entry.selection) {
      const key = entry.selection.status === "conflict" ? "conflicts" : entry.selection.status;
      totals.manual_selections[key] += 1;
    }
    if (entry.promotion) {
      totals.catalog_promotions[entry.promotion.status] += 1;
    } else if (entry.observation || entry.selection) {
      // Reached this entry but never got to promotion — always an explicit
      // "skipped" count, never silently absent (spec §6: never mask a
      // partial failure).
      totals.catalog_promotions.skipped += 1;
    }
  }

  const ok = entries.every((e) => e.errors.length === 0 && (!e.observation || e.observation.status !== "failed") && (!e.selection || e.selection.status !== "failed") && (!e.promotion || e.promotion.status !== "failed"));

  return { ok, dryRun, guardErrors: [], entries, totals };
}
