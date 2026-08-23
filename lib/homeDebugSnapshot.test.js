import { test } from "node:test";
import assert from "node:assert/strict";

import { describeDataType, buildHomeDebugSnapshot } from "./homeDebugSnapshot.js";

test("describeDataType: distinguishes array/null/undefined/other", () => {
  assert.equal(describeDataType([1, 2]), "array");
  assert.equal(describeDataType(null), "null");
  assert.equal(describeDataType(undefined), "undefined");
  assert.equal(describeDataType({}), "object");
  assert.equal(describeDataType("x"), "string");
});

test("buildHomeDebugSnapshot: dashboardWillRender reflects activeNav only, not auth state", () => {
  // This is exactly the real condition in pages/index.js:
  // {activeNav === "accueil" && (...)}` — never gated on auth.loading or
  // auth.user. A regression here (accidentally coupling the render
  // condition to auth) is exactly the kind of bug this investigation is
  // chasing, so it's asserted explicitly.
  const base = { mounted: true, jardin: [], reminders: [], weather: null, pathname: "/" };
  assert.equal(
    buildHomeDebugSnapshot({ ...base, authLoading: true, user: null, activeNav: "accueil" }).dashboardWillRender,
    true
  );
  assert.equal(
    buildHomeDebugSnapshot({ ...base, authLoading: false, user: { id: "u1" }, activeNav: "accueil" }).dashboardWillRender,
    true
  );
  assert.equal(
    buildHomeDebugSnapshot({ ...base, authLoading: false, user: { id: "u1" }, activeNav: "identifier" }).dashboardWillRender,
    false
  );
});

test("buildHomeDebugSnapshot: dashboardBranch follows user presence, independent of loading", () => {
  const base = { mounted: true, jardin: [], reminders: [], weather: null, pathname: "/", activeNav: "accueil" };
  assert.equal(buildHomeDebugSnapshot({ ...base, authLoading: true, user: null }).dashboardBranch, "disconnected");
  assert.equal(buildHomeDebugSnapshot({ ...base, authLoading: false, user: { id: "u1" } }).dashboardBranch, "connected");
});

test("buildHomeDebugSnapshot: jardin/reminders/weather undefined or null never throws, reports safe types/counts", () => {
  const base = { mounted: true, authLoading: false, user: { id: "u1" }, activeNav: "accueil", pathname: "/" };
  const snapshot = buildHomeDebugSnapshot({ ...base, jardin: undefined, reminders: undefined, weather: null });
  assert.equal(snapshot.jardinType, "undefined");
  assert.equal(snapshot.jardinCount, 0);
  assert.equal(snapshot.remindersType, "undefined");
  assert.equal(snapshot.remindersCount, 0);
  assert.equal(snapshot.weatherType, "null");
});

test("buildHomeDebugSnapshot: an incomplete profile never crashes and is reported accurately", () => {
  const base = { mounted: true, authLoading: false, user: { id: "u1" }, jardin: [], reminders: [], weather: null, activeNav: "accueil", pathname: "/" };
  assert.equal(buildHomeDebugSnapshot({ ...base, profile: null }).firstNamePresent, false);
  assert.equal(buildHomeDebugSnapshot({ ...base, profile: {} }).firstNamePresent, false);
  assert.equal(buildHomeDebugSnapshot({ ...base, profile: { first_name: "" } }).firstNamePresent, false);
  assert.equal(buildHomeDebugSnapshot({ ...base, profile: { first_name: "Camille" } }).firstNamePresent, true);
});

test("buildHomeDebugSnapshot: never leaks sensitive user/profile data — only booleans/counts/types", () => {
  const sensitiveEmail = "real.user@example.com";
  const sensitiveId = "auth0|super-secret-user-id";
  const sensitiveToken = "sk_live_should_never_appear";

  const snapshot = buildHomeDebugSnapshot({
    mounted: true,
    authLoading: false,
    user: { id: sensitiveId, email: sensitiveEmail, access_token: sensitiveToken },
    profile: { first_name: "Camille", last_name: "Dupont", city: "Lyon" },
    jardin: [{ id: "p1", data: { identite: { nom_commun: "Lavande" } } }],
    reminders: [{ id: "r1", plantId: "p1" }],
    weather: { location: { city: "Lyon" } },
    activeNav: "accueil",
    pathname: "/",
  });

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(sensitiveEmail), false);
  assert.equal(serialized.includes(sensitiveId), false);
  assert.equal(serialized.includes(sensitiveToken), false);
  assert.equal(serialized.includes("Camille"), false);
  assert.equal(serialized.includes("Dupont"), false);
  assert.equal(serialized.includes("Lyon"), false);
  assert.equal(serialized.includes("Lavande"), false);

  // Only the expected boolean/count/type/string-label keys are present.
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "authLoading",
    "authenticated",
    "dashboardBranch",
    "dashboardWillRender",
    "firstNamePresent",
    "jardinCount",
    "jardinType",
    "mounted",
    "pageReached",
    "pathname",
    "remindersCount",
    "remindersType",
    "userPresent",
    "weatherType",
  ]);
});
