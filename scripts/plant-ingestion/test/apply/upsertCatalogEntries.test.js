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
