import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeList,
  normalizeWeather,
  findTodayWeather,
  weatherCityLabel,
  countDueReminders,
  countOverdueReminders,
  plantDisplayName,
  resolveGreetingName,
  buildConnectedHomeModel,
} from "./homeDashboardData.js";

test("normalizeList: undefined/null/non-array -> [], a real array passes through", () => {
  assert.deepEqual(normalizeList(undefined), []);
  assert.deepEqual(normalizeList(null), []);
  assert.deepEqual(normalizeList("not an array"), []);
  assert.deepEqual(normalizeList({ length: 3 }), []);
  const arr = ["a", "b"];
  assert.equal(normalizeList(arr), arr);
});

test("normalizeWeather: null/undefined/non-object -> null, an object passes through", () => {
  assert.equal(normalizeWeather(null), null);
  assert.equal(normalizeWeather(undefined), null);
  assert.equal(normalizeWeather("clear sky"), null);
  const w = { days: [] };
  assert.equal(normalizeWeather(w), w);
});

test("findTodayWeather: absent/malformed weather never throws, returns null", () => {
  assert.equal(findTodayWeather(null, "2026-08-23"), null);
  assert.equal(findTodayWeather(undefined, "2026-08-23"), null);
  assert.equal(findTodayWeather({}, "2026-08-23"), null);
  assert.equal(findTodayWeather({ days: "not-an-array" }, "2026-08-23"), null);
});

test("findTodayWeather: finds the matching day by date", () => {
  const weather = { days: [{ date: "2026-08-22", temperatureMaxC: 20 }, { date: "2026-08-23", temperatureMaxC: 24 }] };
  assert.deepEqual(findTodayWeather(weather, "2026-08-23"), { date: "2026-08-23", temperatureMaxC: 24 });
  assert.equal(findTodayWeather(weather, "2026-09-01"), null);
});

test("weatherCityLabel: absent location never throws", () => {
  assert.equal(weatherCityLabel(null), null);
  assert.equal(weatherCityLabel({}), null);
  assert.equal(weatherCityLabel({ location: {} }), null);
  assert.equal(weatherCityLabel({ location: { city: "Lyon" } }), "Lyon");
});

test("countDueReminders/countOverdueReminders: undefined/null reminders -> 0, never throws", () => {
  assert.equal(countDueReminders(undefined, "2026-08-23"), 0);
  assert.equal(countDueReminders(null, "2026-08-23"), 0);
  assert.equal(countOverdueReminders(undefined, "2026-08-23"), 0);
});

test("countDueReminders/countOverdueReminders: malformed entries (missing isActive/status/nextDueDate) are excluded, not thrown on", () => {
  const reminders = [
    {},
    { isActive: true },
    { isActive: true, status: "pending" },
    { isActive: true, status: "done", nextDueDate: "2026-08-20" },
    null,
    undefined,
  ];
  assert.equal(countDueReminders(reminders, "2026-08-23"), 0);
  assert.equal(countOverdueReminders(reminders, "2026-08-23"), 0);
});

test("countDueReminders: due today or earlier, active + pending/snoozed only", () => {
  const today = "2026-08-23";
  const reminders = [
    { isActive: true, status: "pending", nextDueDate: "2026-08-20" }, // overdue -> also due
    { isActive: true, status: "snoozed", nextDueDate: "2026-08-23" }, // due today
    { isActive: true, status: "pending", nextDueDate: "2026-08-25" }, // future -> not due
    { isActive: false, status: "pending", nextDueDate: "2026-08-20" }, // inactive -> excluded
    { isActive: true, status: "done", nextDueDate: "2026-08-20" }, // done -> excluded
  ];
  assert.equal(countDueReminders(reminders, today), 2);
});

test("countOverdueReminders: strictly before today only", () => {
  const today = "2026-08-23";
  const reminders = [
    { isActive: true, status: "pending", nextDueDate: "2026-08-20" }, // overdue
    { isActive: true, status: "snoozed", nextDueDate: "2026-08-23" }, // due today, not overdue
    { isActive: true, status: "pending", nextDueDate: "2026-08-25" }, // future
  ];
  assert.equal(countOverdueReminders(reminders, today), 1);
});

test("plantDisplayName: null/undefined plant or missing data never throws", () => {
  assert.equal(plantDisplayName(null), null);
  assert.equal(plantDisplayName(undefined), null);
  assert.equal(plantDisplayName({}), null);
  assert.equal(plantDisplayName({ data: null }), null);
  assert.equal(plantDisplayName({ data: {} }), null);
  assert.equal(plantDisplayName({ data: { identite: {} } }), null);
});

test("plantDisplayName: returns the common name when present", () => {
  assert.equal(plantDisplayName({ data: { identite: { nom_commun: "Lavande" } } }), "Lavande");
});

test("resolveGreetingName: null/undefined/blank profile first name never crashes, never invents a name", () => {
  assert.equal(resolveGreetingName(null), null);
  assert.equal(resolveGreetingName(undefined), null);
  assert.equal(resolveGreetingName(""), null);
  assert.equal(resolveGreetingName("   "), null);
  assert.equal(resolveGreetingName(42), null);
});

test("resolveGreetingName: a real first name is trimmed and returned", () => {
  assert.equal(resolveGreetingName("  Camille  "), "Camille");
});

test("buildConnectedHomeModel: every input undefined produces a fully safe, displayable model", () => {
  const model = buildConnectedHomeModel({ plants: undefined, reminders: undefined, weather: undefined, today: "2026-08-23" });
  assert.deepEqual(model, { plants: [], dueCount: 0, overdueCount: 0, todayWeather: null, weatherCity: null });
});

test("buildConnectedHomeModel: partial real-shaped data produces correct derived values", () => {
  const today = "2026-08-23";
  const model = buildConnectedHomeModel({
    plants: [{ id: "p1" }, { id: "p2" }],
    reminders: [
      { isActive: true, status: "pending", nextDueDate: "2026-08-20" },
      { isActive: true, status: "pending", nextDueDate: today },
    ],
    weather: null,
    today,
  });
  assert.equal(model.plants.length, 2);
  assert.equal(model.dueCount, 2);
  assert.equal(model.overdueCount, 1);
  assert.equal(model.todayWeather, null);
  assert.equal(model.weatherCity, null);
});

test("buildConnectedHomeModel: no combination of malformed plants/reminders/weather ever returns null/undefined or an incomplete model", () => {
  const weirdValues = [undefined, null, [], {}, "not-an-array-or-object", 0, false];
  const today = "2026-08-23";

  for (const plants of weirdValues) {
    for (const reminders of weirdValues) {
      for (const weather of weirdValues) {
        const model = buildConnectedHomeModel({ plants, reminders, weather, today });
        assert.ok(model, "model must never be null/undefined");
        assert.ok(Array.isArray(model.plants), "model.plants must always be an array");
        assert.equal(typeof model.dueCount, "number");
        assert.equal(typeof model.overdueCount, "number");
        assert.ok(model.todayWeather === null || typeof model.todayWeather === "object");
        assert.ok(model.weatherCity === null || typeof model.weatherCity === "string");
      }
    }
  }
});
