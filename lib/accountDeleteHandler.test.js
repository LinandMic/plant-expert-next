// Tests pages/api/account/delete.js's handler logic directly, via its
// injectable createAccountDeleteHandler({ getAdminClient }) factory, with a
// hand-rolled req/res (no test dependency added) and a fake Supabase admin
// client — no real network call, no real credentials, matching
// lib/apiProxyHandler.test.js's own approach for pages/api/proxy.js.
//
// Deliberately NOT colocated under pages/api/account/ as
// pages/api/account/delete.test.js: Next.js's pages router treats every
// file under pages/ as a route by file path with no built-in exclusion for
// *.test.js (see lib/apiProxyHandler.test.js's own comment) — lib/ is
// outside the pages/ routing tree.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAccountDeleteHandler, extractBearerToken } from "../pages/api/account/delete.js";

const HOST = "plant-expert-next-rxq9.vercel.app";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const TOKEN = "valid-test-token";

function makeReq({ method = "POST", origin, referer, authorization, body } = {}) {
  const headers = { host: HOST };
  if (origin !== undefined) headers.origin = origin;
  if (referer !== undefined) headers.referer = referer;
  if (authorization !== undefined) headers.authorization = authorization;
  return { method, headers, body };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

// Builds a fake admin client. Every call is recorded so tests can assert
// exactly what was targeted (which user id, which bucket, which paths) —
// this is how "cleanup targets only the authenticated user" and "shared
// botanical tables are never targeted" get verified: the fake data store
// only ever contains rows for USER_ID and OTHER_USER_ID, and any query
// scoped to the wrong id, or to a table this handler has no business
// touching, would show up in the call log.
function makeFakeAdmin({
  getUserResult = { data: { user: { id: USER_ID } }, error: null },
  photoRows = [],
  removeError = null,
  deleteUserError = null,
  order = null,
} = {}) {
  const calls = { getUser: [], select: [], remove: [], deleteUser: [] };

  return {
    calls,
    auth: {
      getUser: async (token) => {
        calls.getUser.push(token);
        return getUserResult;
      },
      admin: {
        deleteUser: async (userId) => {
          if (order) order.push("deleteUser");
          calls.deleteUser.push(userId);
          return { error: deleteUserError };
        },
      },
    },
    from(table) {
      return {
        select(columns) {
          return {
            eq: async (column, value) => {
              calls.select.push({ table, columns, column, value });
              return { data: photoRows, error: null };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          remove: async (paths) => {
            if (order) order.push("remove");
            calls.remove.push({ bucket, paths });
            return { error: removeError };
          },
        };
      },
    },
  };
}

test("extractBearerToken: parses a well-formed header", () => {
  assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
});

test("extractBearerToken: missing, empty, or malformed header -> null", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("abc.def.ghi"), null);
  assert.equal(extractBearerToken("Bearer "), null);
  assert.equal(extractBearerToken("Basic abc"), null);
});

test("non-POST method is rejected (405), admin client never constructed", async () => {
  let constructed = false;
  const handler = createAccountDeleteHandler({
    getAdminClient: () => {
      constructed = true;
      return makeFakeAdmin();
    },
  });
  const req = makeReq({ method: "GET", origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(constructed, false);
});

test("external origin is rejected (403), admin client never constructed", async () => {
  let constructed = false;
  const handler = createAccountDeleteHandler({
    getAdminClient: () => {
      constructed = true;
      return makeFakeAdmin();
    },
  });
  const req = makeReq({ origin: "https://evil.example.com", authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(constructed, false);
});

test("native origin is accepted and gets scoped CORS headers", async () => {
  const admin = makeFakeAdmin({ photoRows: [] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: "capacitor://localhost", authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "capacitor://localhost");
});

test("missing Authorization header is rejected (401), admin client never constructed", async () => {
  let constructed = false;
  const handler = createAccountDeleteHandler({
    getAdminClient: () => {
      constructed = true;
      return makeFakeAdmin();
    },
  });
  const req = makeReq({ origin: `https://${HOST}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(constructed, false);
});

test("invalid/expired token is rejected (401), no storage or deletion calls made", async () => {
  const admin = makeFakeAdmin({ getUserResult: { data: null, error: { message: "invalid token" } } });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: "Bearer garbage" });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(admin.calls.select.length, 0);
  assert.equal(admin.calls.remove.length, 0);
  assert.equal(admin.calls.deleteUser.length, 0);
});

test("authenticated user id comes from the verified token, not the request body", async () => {
  const admin = makeFakeAdmin({ photoRows: [] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  // Body claims a different user id — must be completely ignored.
  const req = makeReq({
    origin: `https://${HOST}`,
    authorization: `Bearer ${TOKEN}`,
    body: { userId: OTHER_USER_ID },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.select[0].value, USER_ID);
  assert.equal(admin.calls.deleteUser[0], USER_ID);
});

test("cleanup targets only the authenticated user's storage_path rows (plant_photos, scoped by user_id)", async () => {
  const admin = makeFakeAdmin({ photoRows: [{ storage_path: `${USER_ID}/plant-a/primary.jpg` }] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.select.length, 1);
  assert.equal(admin.calls.select[0].table, "plant_photos");
  assert.equal(admin.calls.select[0].column, "user_id");
  assert.equal(admin.calls.select[0].value, USER_ID);
});

test("storage paths are restricted to exactly the authenticated user's rows, passed to the plant-photos bucket only", async () => {
  const admin = makeFakeAdmin({
    photoRows: [
      { storage_path: `${USER_ID}/plant-a/primary.jpg` },
      { storage_path: `${USER_ID}/plant-b/primary.jpg` },
    ],
  });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.remove.length, 1);
  assert.equal(admin.calls.remove[0].bucket, "plant-photos");
  assert.deepEqual(admin.calls.remove[0].paths, [
    `${USER_ID}/plant-a/primary.jpg`,
    `${USER_ID}/plant-b/primary.jpg`,
  ]);
});

test("shared botanical tables are never targeted: only plant_photos is ever queried", async () => {
  const admin = makeFakeAdmin({ photoRows: [] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const tablesTouched = new Set(admin.calls.select.map((c) => c.table));
  assert.deepEqual([...tablesTouched], ["plant_photos"]);
});

test("no photos -> storage.remove is never called, deletion still proceeds", async () => {
  const admin = makeFakeAdmin({ photoRows: [] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.remove.length, 0);
  assert.equal(admin.calls.deleteUser.length, 1);
});

test("auth user deletion happens only after storage cleanup succeeds, and in that order", async () => {
  const order = [];
  const admin = makeFakeAdmin({ photoRows: [{ storage_path: `${USER_ID}/p/primary.jpg` }], order });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, ["remove", "deleteUser"]);
});

test("storage cleanup failure prevents auth deletion and returns an explicit error", async () => {
  const admin = makeFakeAdmin({
    photoRows: [{ storage_path: `${USER_ID}/p/primary.jpg` }],
    removeError: { message: "storage backend unavailable" },
  });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(admin.calls.deleteUser.length, 0);
  // Never leaks the raw backend error string to the client.
  assert.equal(JSON.stringify(res.body).includes("storage backend unavailable"), false);
});

test("listing storage paths failure prevents both removal and auth deletion", async () => {
  const admin = makeFakeAdmin();
  admin.from = () => ({
    select: () => ({
      eq: async () => ({ data: null, error: { message: "db unreachable" } }),
    }),
  });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(admin.calls.remove.length, 0);
  assert.equal(admin.calls.deleteUser.length, 0);
});

test("auth user deletion failure (after successful storage cleanup) returns an explicit error, never a silent success", async () => {
  const admin = makeFakeAdmin({
    photoRows: [{ storage_path: `${USER_ID}/p/primary.jpg` }],
    deleteUserError: { message: "gotrue unavailable" },
  });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(admin.calls.remove.length, 1);
  assert.equal(admin.calls.deleteUser.length, 1);
  assert.equal(JSON.stringify(res.body).includes("gotrue unavailable"), false);
});

test("repeated request after already-cleaned photos is handled safely (idempotent: empty photo list, deletion still succeeds)", async () => {
  // Simulates a retry after a prior run already removed the storage
  // objects and their plant_photos rows (e.g. deleteUser had actually
  // succeeded server-side but the client never saw the response) — the
  // second call simply finds no photo rows left and proceeds cleanly.
  const admin = makeFakeAdmin({ photoRows: [] });
  const handler = createAccountDeleteHandler({ getAdminClient: () => admin });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(admin.calls.remove.length, 0);
  assert.equal(admin.calls.deleteUser.length, 1);
});

test("admin client construction failure (missing server credentials) returns a safe 500, never a stack trace", async () => {
  const handler = createAccountDeleteHandler({
    getAdminClient: () => {
      throw new Error("Supabase admin credentials are not configured");
    },
  });
  const req = makeReq({ origin: `https://${HOST}`, authorization: `Bearer ${TOKEN}` });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(typeof res.body.error, "string");
});
