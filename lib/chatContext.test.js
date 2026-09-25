import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveIdentificationContext,
  resolvePlantContext,
  resolveChatContext,
  resolveGeneralContext,
} from "./chatContext.js";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const PLANT_A_ID = "33333333-3333-3333-3333-333333333333";

// A minimal, generic stand-in for a Supabase PostgrestFilterBuilder:
// .eq/.in/.lte accumulate row-level predicates, .order/.select are no-ops
// (row shape/order don't matter to what's under test), .limit caps the
// result, .maybeSingle() and a bare `await` (via .then) are both valid
// terminal calls — matching how resolveGeneralContext actually queries.
function makeGenericTable(rows) {
  return {
    select() {
      return this;
    },
    eq(col, val) {
      this._filters = (this._filters || []).concat((r) => r[col] === val);
      return this;
    },
    in(col, vals) {
      this._filters = (this._filters || []).concat((r) => vals.includes(r[col]));
      return this;
    },
    lte(col, val) {
      this._filters = (this._filters || []).concat((r) => r[col] <= val);
      return this;
    },
    order() {
      return this;
    },
    limit(n) {
      this._limit = n;
      return this;
    },
    _matches() {
      return rows.filter((r) => (this._filters || []).every((f) => f(r))).slice(0, this._limit ?? Infinity);
    },
    async maybeSingle() {
      const matches = this._matches();
      return { data: matches[0] || null, error: null };
    },
    then(resolve, reject) {
      Promise.resolve({ data: this._matches(), error: null }).then(resolve, reject);
    },
  };
}

function makeAdmin({ plants = [], catalog = [], gardenZones = [], reminders = [], profiles = [] } = {}) {
  const calls = { plants: [], catalog: [] };
  return {
    calls,
    from(table) {
      if (table === "plants") {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                const afterFirstEq = {
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
                  limit(n) {
                    const filtered = plants.filter((p) => p[col1] === val1).slice(0, n);
                    return Promise.resolve({ data: filtered, error: null });
                  },
                };
                return afterFirstEq;
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
      if (table === "garden_zones") return makeGenericTable(gardenZones);
      if (table === "plant_reminders") return makeGenericTable(reminders);
      if (table === "profiles") return makeGenericTable(profiles);
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

test("resolveChatContext: mode 'general' derives a bounded context from the user's own data, ignoring rawContext entirely", async () => {
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia", zone_id: null }],
  });
  // Even if the client tried to smuggle fields into rawContext for
  // "general" mode, none of them are ever read — general mode's only
  // input is the verified userId.
  const result = await resolveChatContext({
    admin,
    userId: USER_A,
    rawContext: { mode: "general", plants: ["fake"], location: { city: "Nowhere" } },
  });
  assert.equal(result.mode, "general");
  assert.equal(result.general.plants.length, 1);
  assert.equal(result.general.plants[0].commonName, "Hortensia");
});

test("resolveChatContext: unrecognised/missing mode defaults to 'general', never throws, and still returns bounded context", async () => {
  const admin = makeAdmin();
  const a = await resolveChatContext({ admin, userId: USER_A, rawContext: null });
  assert.equal(a.mode, "general");
  assert.deepEqual(a.general.plants, []);
  const b = await resolveChatContext({ admin, userId: USER_A, rawContext: { mode: "something-unknown" } });
  assert.equal(b.mode, "general");
  assert.deepEqual(b.general.plants, []);
});

// --- resolveGeneralContext -------------------------------------------

test("resolveGeneralContext: empty garden degrades safely (no plants, zones, reminders, or profile row)", async () => {
  const admin = makeAdmin();
  const general = await resolveGeneralContext(admin, USER_A);
  assert.deepEqual(general, { plantCount: 0, plants: [], zones: [], reminders: [], location: null });
});

test("resolveGeneralContext: missing/empty profile location degrades safely to location: null", async () => {
  const admin = makeAdmin({ profiles: [{ id: USER_A, city: null, region: null, country: null }] });
  const general = await resolveGeneralContext(admin, USER_A);
  assert.equal(general.location, null);
});

test("resolveGeneralContext: a user's own plants/zones/reminders/profile are all scoped to that user only", async () => {
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia", location: "Terrasse", zone_id: "zone-a" }],
    gardenZones: [{ id: "zone-a", user_id: USER_A, name: "Terrasse", exposure: "full_sun", orientation: "s" }],
    reminders: [
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "watering", is_active: true, status: "pending", next_due_date: "2000-01-01" },
    ],
    profiles: [{ id: USER_A, city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "France" }],
  });

  const general = await resolveGeneralContext(admin, USER_A);
  assert.equal(general.plants.length, 1);
  assert.equal(general.plants[0].commonName, "Hortensia");
  assert.equal(general.plants[0].zoneName, "Terrasse");
  assert.equal(general.zones.length, 1);
  assert.equal(general.reminders.length, 1);
  assert.equal(general.reminders[0].plantName, "Hortensia");
  assert.equal(general.reminders[0].overdue, true);
  assert.deepEqual(general.location, { city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "France" });
});

test("resolveGeneralContext: user B's context never includes user A's plants, zones, reminders, or profile", async () => {
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia", zone_id: null }],
    gardenZones: [{ id: "zone-a", user_id: USER_A, name: "Terrasse" }],
    reminders: [
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "watering", is_active: true, status: "pending", next_due_date: "2000-01-01" },
    ],
    profiles: [{ id: USER_A, city: "Lyon", region: null, country: null }],
  });

  const general = await resolveGeneralContext(admin, USER_B);
  assert.deepEqual(general, { plantCount: 0, plants: [], zones: [], reminders: [], location: null });
});

test("resolveGeneralContext: reminder due-date ordering distinguishes overdue from due-today, and excludes future/inactive/done reminders", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: "Hortensia", zone_id: null }],
    reminders: [
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "watering", is_active: true, status: "pending", next_due_date: "2000-01-01" }, // overdue
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "pruning", is_active: true, status: "snoozed", next_due_date: today }, // due today
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "fertilizing", is_active: true, status: "pending", next_due_date: "2999-01-01" }, // future — excluded
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "repotting", is_active: false, status: "pending", next_due_date: "2000-01-01" }, // inactive — excluded
      { user_id: USER_A, plant_id: PLANT_A_ID, type: "pest_check", is_active: true, status: "done", next_due_date: "2000-01-01" }, // done — excluded
    ],
  });

  const general = await resolveGeneralContext(admin, USER_A);
  assert.equal(general.reminders.length, 2);
  assert.equal(general.reminders.find((r) => r.type === "watering").overdue, true);
  assert.equal(general.reminders.find((r) => r.type === "pruning").overdue, false);
});

test("resolveGeneralContext: bounded context size — plants/zones/reminders are each capped, never an unlimited dump", async () => {
  const manyPlants = Array.from({ length: 60 }, (_, i) => ({
    id: `plant-${i}`,
    user_id: USER_A,
    common_name: `Plante ${i}`,
    zone_id: null,
  }));
  const manyReminders = manyPlants.map((p) => ({
    user_id: USER_A,
    plant_id: p.id,
    type: "watering",
    is_active: true,
    status: "pending",
    next_due_date: "2000-01-01",
  }));
  const manyZones = Array.from({ length: 40 }, (_, i) => ({ id: `zone-${i}`, user_id: USER_A, name: `Zone ${i}` }));

  const admin = makeAdmin({ plants: manyPlants, reminders: manyReminders, gardenZones: manyZones });
  const general = await resolveGeneralContext(admin, USER_A);

  assert.ok(general.plants.length <= 25, `expected <=25 plants, got ${general.plants.length}`);
  assert.ok(general.reminders.length <= 20, `expected <=20 reminders, got ${general.reminders.length}`);
  assert.ok(general.zones.length <= 15, `expected <=15 zones, got ${general.zones.length}`);
});

test("resolveGeneralContext: free-text fields are truncated defensively, never forwarded raw and unbounded", async () => {
  const huge = "x".repeat(5000);
  const admin = makeAdmin({
    plants: [{ id: PLANT_A_ID, user_id: USER_A, common_name: huge, location: huge, zone_id: null }],
    gardenZones: [{ id: "zone-a", user_id: USER_A, name: huge }],
  });
  const general = await resolveGeneralContext(admin, USER_A);
  assert.ok(general.plants[0].commonName.length <= 200);
  assert.ok(general.plants[0].location.length <= 200);
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
