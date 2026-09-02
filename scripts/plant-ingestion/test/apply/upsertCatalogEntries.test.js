import { test } from "node:test";
import assert from "node:assert/strict";

import { upsertCatalogEntries } from "../../src/apply/upsertCatalogEntries.js";
import { createFakeSupabaseClient } from "./fakeSupabaseClient.js";
import { buildCatalogEntry } from "./fixtures.js";

const taxonIdByRef = new Map([["acer_palmatum", "taxon-1"]]);

test("creates a species entry, then reports unchanged on an identical re-apply", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const first = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry()], taxonIdByRef, dryRun: false });
  assert.equal(first.created, 1);
  assert.equal(tables.plant_catalog.length, 1);
  // First creation takes the plan's draft/unreviewed values.
  assert.equal(tables.plant_catalog[0].publication_status, "draft");
  assert.equal(tables.plant_catalog[0].review_status, "unreviewed");

  const second = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry()], taxonIdByRef, dryRun: false });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(tables.plant_catalog.length, 1);
});

test("CRITICAL: an update never reverts a curator-published entry back to draft/unreviewed", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [
      {
        id: "catalog-1",
        ...buildCatalogEntry(),
        // A curator already promoted this row in production.
        publication_status: "published",
        review_status: "reviewed",
        published_at: "2026-02-01T00:00:00.000Z",
        // But an ingestion field genuinely changed upstream.
        height_max_cm: 750,
      },
    ],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ height_max_cm: 800 })], // plan always says draft/unreviewed
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(result.updated, 1);
  const row = tables.plant_catalog[0];
  assert.equal(row.height_max_cm, 800); // ingestion field WAS updated
  assert.equal(row.publication_status, "published"); // curator field untouched
  assert.equal(row.review_status, "reviewed"); // curator field untouched
  assert.equal(row.published_at, "2026-02-01T00:00:00.000Z"); // curator field untouched
});

test("dry-run never writes, even when the row would change", async () => {
  const { tables, client } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry(), height_max_cm: 750 }],
  });
  const result = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry({ height_max_cm: 800 })], taxonIdByRef, dryRun: true });
  assert.equal(result.updated, 1);
  assert.equal(tables.plant_catalog[0].height_max_cm, 750); // unchanged in the fake DB
});

test("processes species before cultivars regardless of input array order", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const species = buildCatalogEntry();
  const cultivar = buildCatalogEntry({
    catalog_ref: "acer_palmatum_bloodgood",
    parent_catalog_ref: "acer_palmatum_species",
    entry_type: "cultivar",
    cultivar_name: "Bloodgood",
    display_name: "Acer palmatum 'Bloodgood'",
    slug: "acer-palmatum-bloodgood",
  });

  // Cultivar listed FIRST in the input array — the function must still
  // resolve it because it internally orders species before cultivars.
  const result = await upsertCatalogEntries({ client, catalogEntries: [cultivar, species], taxonIdByRef, dryRun: false });
  assert.equal(result.created, 2);
  assert.equal(result.errors.length, 0);
  const cultivarRow = tables.plant_catalog.find((r) => r.slug === "acer-palmatum-bloodgood");
  const speciesRow = tables.plant_catalog.find((r) => r.slug === "acer-palmatum");
  assert.equal(cultivarRow.parent_catalog_id, speciesRow.id);
});

test("a missing parent taxon is reported as 'created' without a DB lookup", async () => {
  const { client, tables } = createFakeSupabaseClient();
  const result = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry()], taxonIdByRef: new Map(), dryRun: false });
  assert.equal(result.created, 1);
  assert.equal((tables.plant_catalog ?? []).length, 0);
  assert.equal(result.idByRef.get("acer_palmatum_species"), null);
});

// ==================================================================
// manual_resolution protection (real Rhododendron simsii production
// regression, spec: "un apply provider ne peut JAMAIS écraser un trait
// catalog actuellement contrôlé par une selection manual_resolution").
// ==================================================================

function seedManualResolution(overrides = {}) {
  return { id: "sel-1", plant_catalog_id: "catalog-1", trait: "plant_type", decision_method: "manual_resolution", ...overrides };
}

// 1. Régression exacte Rhododendron simsii: provider plan plant_type=null,
// catalog déjà à "shrub" via une manual_resolution éditoriale -> reste "shrub".
test("REGRESSION (Rhododendron simsii): a provider plan proposing plant_type=null never overwrites a manual_resolution-protected plant_type", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub" }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ plant_type: null })], // the real, stale provider plan for Rhododendron
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(tables.plant_catalog[0].plant_type, "shrub"); // never reverted to null
  assert.equal(result.protectedFields.length, 1);
  assert.deepEqual(result.protectedFields[0], { catalog_ref: "acer_palmatum_species", trait: "plant_type", provider_value: null, current_value: "shrub" });
});

// 2. manual plant_type protège contre provider proposant une AUTRE valeur non-null.
test("manual_resolution on plant_type protects against a provider proposing a different non-null value", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub" }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ plant_type: "perennial" })],
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(tables.plant_catalog[0].plant_type, "shrub");
  assert.equal(result.protectedFields.length, 1);
  assert.equal(result.protectedFields[0].provider_value, "perennial");
});

// 3. provider peut updater sun pendant que plant_type est protégé (granularité par trait).
test("provider can still update sun while plant_type is protected — protection is per-trait, not per-row", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub", sun: ["shade"] }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ plant_type: null, sun: ["full_sun"] })],
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(result.updated, 1); // sun genuinely changed -> real update
  assert.equal(tables.plant_catalog[0].plant_type, "shrub"); // still protected
  assert.deepEqual(tables.plant_catalog[0].sun, ["full_sun"]); // provider update went through
  assert.equal(result.protectedFields.length, 1);
  assert.equal(result.protectedFields[0].trait, "plant_type");
});

// 4. aucune manual_resolution => comportement provider actuel inchangé.
test("no manual_resolution at all -> provider updates the trait normally, exactly as before", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "tree" }) }],
    plant_trait_selections: [],
  });

  const result = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry({ plant_type: "shrub" })], taxonIdByRef, dryRun: false });

  assert.equal(result.updated, 1);
  assert.equal(tables.plant_catalog[0].plant_type, "shrub");
  assert.equal(result.protectedFields.length, 0);
});

// 5. decision_method="provider_observation" n'a PAS la protection absolue.
test("a selection with decision_method=\"provider_observation\" does NOT protect the column — only manual_resolution does", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "tree" }) }],
    plant_trait_selections: [seedManualResolution({ decision_method: "provider_observation" })],
  });

  const result = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry({ plant_type: "shrub" })], taxonIdByRef, dryRun: false });

  assert.equal(tables.plant_catalog[0].plant_type, "shrub"); // updated normally
  assert.equal(result.protectedFields.length, 0);
});

// 6. manual_resolution sur sun protège le tableau sun.
test("manual_resolution on sun protects the sun array against a provider re-proposal", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ sun: ["shade"] }) }],
    plant_trait_selections: [seedManualResolution({ trait: "sun" })],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ sun: ["full_sun", "partial_sun"] })],
    taxonIdByRef,
    dryRun: false,
  });

  assert.deepEqual(tables.plant_catalog[0].sun, ["shade"]);
  assert.equal(result.protectedFields.length, 1);
  assert.equal(result.protectedFields[0].trait, "sun");
});

// 7. manual_resolution boolean false protège false (jamais confondu avec absent).
test("manual_resolution protecting evergreen=false is preserved against a provider proposing true or null", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ evergreen: false }) }],
    plant_trait_selections: [seedManualResolution({ trait: "evergreen" })],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ evergreen: true })],
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(tables.plant_catalog[0].evergreen, false);
  assert.equal(result.protectedFields.length, 1);
  assert.equal(result.protectedFields[0].current_value, false);
  assert.equal(result.protectedFields[0].provider_value, true);
});

// 8. manual_resolution numeric protège une valeur numérique (height_min_cm).
// Confirme aussi que height_min_cm/height_max_cm sont protégés SÉPARÉMENT
// (deux blocs distincts, jamais une protection groupée) — seul
// height_min_cm est sous manual_resolution ici, height_max_cm reste
// librement mis à jour par le provider.
test("manual_resolution on height_min_cm protects it independently — height_max_cm remains provider-updatable", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ height_min_cm: 150, height_max_cm: 800 }) }],
    plant_trait_selections: [seedManualResolution({ trait: "height_min_cm" })],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ height_min_cm: 0, height_max_cm: 900 })],
    taxonIdByRef,
    dryRun: false,
  });

  assert.equal(tables.plant_catalog[0].height_min_cm, 150); // protected
  assert.equal(tables.plant_catalog[0].height_max_cm, 900); // freely updated
  assert.equal(result.protectedFields.length, 1);
  assert.equal(result.protectedFields[0].trait, "height_min_cm");
});

// 9. publication_status jamais touché, même avec une protection active.
test("publication_status stays untouched even when a manual_resolution protection is also active", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub", publication_status: "published", review_status: "reviewed" }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry({ plant_type: null, height_max_cm: 999 })], taxonIdByRef, dryRun: false });

  assert.equal(tables.plant_catalog[0].publication_status, "published");
  assert.equal(tables.plant_catalog[0].review_status, "reviewed");
});

// 10. dry-run cohérent: si le SEUL champ qui diffère est protégé, la ligne
// reste "unchanged" (jamais "updated" pour un écart qui sera de toute
// façon ignoré à l'apply) — la vraie régression Rhododendron, en dry-run.
test("dry-run coherence: a row whose only differing field is protected reports unchanged, never updated", async () => {
  const { client } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub" }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ plant_type: null })], // only field that differs
    taxonIdByRef,
    dryRun: true,
  });

  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(result.protectedFields.length, 1);
});

test("dry-run never writes, protection included: nothing changes in the fake DB", async () => {
  const { client, tables } = createFakeSupabaseClient({
    plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub", sun: ["shade"] }) }],
    plant_trait_selections: [seedManualResolution()],
  });

  const result = await upsertCatalogEntries({
    client,
    catalogEntries: [buildCatalogEntry({ plant_type: null, sun: ["full_sun"] })],
    taxonIdByRef,
    dryRun: true,
  });

  assert.equal(result.updated, 1); // sun would genuinely change
  assert.equal(tables.plant_catalog[0].plant_type, "shrub"); // untouched in dry-run
  assert.deepEqual(tables.plant_catalog[0].sun, ["shade"]); // untouched in dry-run
});

// 11. Un échec de la lecture de protection ne doit jamais aboutir à une
// écriture "à l'aveugle" — la ligne est refusée, pas silencieusement
// écrite sans vérification.
test("a failed plant_trait_selections lookup blocks the write entirely, never falls back to an unprotected update", async () => {
  const { client, tables } = createFakeSupabaseClient(
    { plant_catalog: [{ id: "catalog-1", ...buildCatalogEntry({ plant_type: "shrub" }) }] },
    { failOn: { plant_trait_selections: { select: "forced protection lookup failure" } } }
  );

  const result = await upsertCatalogEntries({ client, catalogEntries: [buildCatalogEntry({ plant_type: null })], taxonIdByRef, dryRun: false });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /manual_resolution protection/);
  assert.equal(tables.plant_catalog[0].plant_type, "shrub"); // never written
});
