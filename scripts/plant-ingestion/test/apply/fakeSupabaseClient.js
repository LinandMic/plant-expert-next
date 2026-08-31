// In-memory fake of the tiny slice of the supabase-js query builder that
// Layer C's upsert/verify modules actually use: from().select()/insert()/
// update(), .eq()/.is() filters, .single()/.maybeSingle() terminals, and
// plain awaiting the builder itself (mirrors supabase-js's thenable query
// builder — no network, no real DB, entirely deterministic).
//
// This exists so `npm test` / plant:ingestion:test never depend on a real
// Supabase project: every Layer C unit test seeds a fake table set,
// exercises the real upsert/apply/verify code against it, and asserts on
// the resulting in-memory rows.

let idCounter = 0;
function nextFakeId() {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

function pickColumns(row, colsSpec) {
  if (!colsSpec) return { ...row };
  const cols = colsSpec.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

// createFakeSupabaseClient(seed = {}, options = {}) -> { client, tables }
// `seed` maps table name -> initial array of rows (each row must include
// `id`). `tables` is the live in-memory store — read it directly in
// assertions after exercising the code under test.
//
// `options.failOn` optionally forces specific operations to return a
// Supabase-shaped error instead of touching the in-memory store — this is
// how the applyPlan dependency-skip tests simulate a parent-step DB
// failure without a real network. Shape:
//   { [tableName]: { select?: string | true, insert?: string | true, update?: string | true } }
// A `true` value uses a generic message; a string is used verbatim. Absent
// entirely by default, so every existing test (no options passed) behaves
// exactly as before.
export function createFakeSupabaseClient(seed = {}, options = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const failOn = options.failOn ?? {};

  function from(tableName) {
    if (!tables[tableName]) tables[tableName] = [];
    const table = tables[tableName];

    let mode = null; // "select" | "insert" | "update"
    let selectCols = null;
    let insertRow = null;
    let updateRow = null;
    let single = false;
    let maybeSingle = false;
    const filters = [];

    const builder = {
      select(cols) {
        selectCols = cols;
        if (!mode) mode = "select";
        return builder;
      },
      eq(col, val) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      is(col, val) {
        filters.push((row) => (row[col] ?? null) === val);
        return builder;
      },
      insert(row) {
        mode = "insert";
        insertRow = row;
        return builder;
      },
      update(row) {
        mode = "update";
        updateRow = row;
        return builder;
      },
      single() {
        single = true;
        return builder;
      },
      maybeSingle() {
        maybeSingle = true;
        return builder;
      },
      then(resolve, reject) {
        try {
          resolve(execute());
        } catch (err) {
          if (reject) reject(err);
          else resolve({ data: null, error: { message: err.message } });
        }
      },
    };

    function forcedError() {
      const cfg = failOn[tableName]?.[mode];
      if (!cfg) return null;
      const message = typeof cfg === "string" ? cfg : `${tableName} ${mode} forced failure (test)`;
      return { data: null, error: { message } };
    }

    function execute() {
      const forced = forcedError();
      if (forced) return forced;

      if (mode === "insert") {
        const row = { id: insertRow.id ?? nextFakeId(), ...insertRow };
        if (!("id" in insertRow)) row.id = insertRow.id ?? nextFakeId();
        table.push(row);
        if (single || selectCols) {
          return { data: pickColumns(row, selectCols), error: null };
        }
        return { data: null, error: null };
      }

      if (mode === "update") {
        const matches = table.filter((row) => filters.every((f) => f(row)));
        for (const row of matches) Object.assign(row, updateRow);
        return { data: null, error: null };
      }

      // select
      const matches = table.filter((row) => filters.every((f) => f(row)));
      const projected = matches.map((row) => pickColumns(row, selectCols));
      if (maybeSingle) {
        return { data: projected[0] ?? null, error: null };
      }
      if (single) {
        if (projected.length === 0) return { data: null, error: { message: `${tableName}: no rows matched .single()` } };
        return { data: projected[0], error: null };
      }
      return { data: projected, error: null };
    }

    return builder;
  }

  return { client: { from }, tables };
}
