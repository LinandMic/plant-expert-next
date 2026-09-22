import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveIdentificationContext, resolvePlantContext, resolveChatContext } from "./chatContext.js";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const PLANT_A_ID = "33333333-3333-3333-3333-333333333333";

function makeAdmin({ plants = [], catalog = [] } = {}) {
  const calls = { plants: [], catalog: [] };
  return {
    calls,
    from(table) {
      if (table === "plants") {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    return {
                      async maybeSingle() {
                        calls.plants.push({ cols, col1, val1, col2, val2 });
                        const filters = { [col1]: val1, [col2]: val2 };
                        const row = plants.find((p) => p.id === filters.id && p.user_id === filters.user_id);
                        return { data: row || null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "plant_catalog") {
        return {
          select(cols) {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    calls.catalog.push({ cols, col, val });
                    const row = catalog.find((c) => c.id === val);
                    return { data: row || null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("resolveIdentificationContext whitelists exactly the spec's named fields, dropping everything else", () => {
  const result = resolveIdentificationContext({
    commonName: "Hortensia",
    latinName: "Hydrangea macrophylla",
    category: "arbuste",
    plantationLabel: "En pleine terre",
    usageLabel: "Ornemental",
    // Everything below must never survive into the result — this is the
    // "do not inject the entire original AI JSON into the prompt" rule.
    aiRawJson: { maladies: ["fake"], description: "a huge blob" },
    description: "should never appear",
    confiance: "haute",
    userId: "attacker-supplied-id",
  });

  assert.deepEqual(result, {
    commonName: "Hortensia",
    latinName: "Hydrangea macrophylla",
    category: "arbuste",
    plantationLabel: "En pleine terre",
    usageLabel: "Ornemental",
  });
});

test("resolveIdentificationContext returns null when neither name field is present", () => {
  assert.equal(resolveIdentificationContext({ category: "arbuste" }), null);
  assert.equal(resolveIdentificationContext(null), null);
  assert.equal(resolveIdentificationContext("not an object"), null);
});

test("resolveIdentificationContext truncates absurdly long field values rather than forwarding them raw", () => {
  const huge = "x".repeat(5000);
  const result = resolveIdentificationContext({ commonName: huge });
  assert.ok(result.commonName.length <= 200);
});

test("resolvePlantContext: owner can fetch their own plant, scoped to a curated field list", async () => {
  const admin = makeAdmin({
    plants: [
      {
        id: PLANT_A_ID,
        user_id: USER_A,
        common_name: "Hortensia",
        latin_name: "Hydrangea macrophylla",
        family: "Hydrangeaceae",
        category: "arbuste",
        location: "Terrasse",
        exposure: "mi-ombre",
        orientation: "nord",
        watering_mode: "manual",
        watering_type: null,
        watering_frequency_days: null,
        catalog_plant_id: null,
        // Fields that must NEVER leak into AI context even though they
        // exist on the row: ai_data (can be a huge raw blob) and the
        // user_id itself.
        ai_data: { huge: "blob", secret: "should never appear" },
      },
    ],
  });

  const result = await resolvePlantContext(admin, USER_A, PLANT_A_ID);
  assert.equal(result.error, undefined);
  assert.equal(result.plant.commonName, "Hortensia");
  assert.equal(result.plant.latinName, "Hydrangea macrophylla");
  assert.equal("ai_data" in result.plant, false);
  assert.equal("user_id" in result.plant, false);
  assert.equal("id" in result.plant, false);
});

test("resolvePlantContext: user B cannot fetch user A's plant by id — comes back NOT_FOUND, not a permission-denied leak", async () => {
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia" }],
  });

  const result = await resolvePlantContext(admin, USER_B, PLANT_A_ID);
  assert.deepEqual(result, { error: "NOT_FOUND" });
  // The lookup itself was still scoped by both id AND the (wrong) caller
  // id — never a query that could return another user's row.
  assert.equal(admin.calls.plants.length, 1);
  assert.equal(admin.calls.plants[0].val2, USER_B);
});

test("resolvePlantContext: non-UUID plant id is rejected before any query is issued", async () => {
  const admin = makeAdmin({ plants: [{ id: PLANT_A_ID, user_id: USER_A }] });
  const result = await resolvePlantContext(admin, USER_A, "'; drop table plants; --");
  assert.deepEqual(result, { error: "INVALID_PLANT_ID" });
  assert.equal(admin.calls.plants.length, 0);
});

test("resolveChatContext: mode 'general' never touches the database", async () => {
  const admin = makeAdmin();
  const result = await resolveChatContext({ admin, userId: USER_A, rawContext: { mode: "general" } });
  assert.deepEqual(result, { mode: "general" });
  assert.equal(admin.calls.plants.length, 0);
});

test("resolveChatContext: unrecognised/missing mode defaults to 'general', never throws", async () => {
  const admin = makeAdmin();
  assert.deepEqual(await resolveChatContext({ admin, userId: USER_A, rawContext: null }), { mode: "general" });
  assert.deepEqual(await resolveChatContext({ admin, userId: USER_A, rawContext: { mode: "something-unknown" } }), {
    mode: "general",
  });
});

test("resolveChatContext: mode 'plant' delegates to resolvePlantContext using the plantId key only", async () => {
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia" }],
  });
  const result = await resolveChatContext({
    admin,
    userId: USER_A,
    rawContext: { mode: "plant", plantId: PLANT_A_ID, userId: USER_B }, // an embedded userId must be ignored
  });
  assert.equal(result.mode, "plant");
  assert.equal(result.plant.commonName, "Hortensia");
});

test("resolveChatContext: mode 'identification' with no usable fields is rejected", async () => {
  const admin = makeAdmin();
  const result = await resolveChatContext({ admin, userId: USER_A, rawContext: { mode: "identification", identification: {} } });
  assert.deepEqual(result, { mode: "identification", error: "INVALID_IDENTIFICATION_CONTEXT" });
});
