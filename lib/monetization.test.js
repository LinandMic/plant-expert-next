import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeMonetizationStatus } from "./monetizationApi.js";
import {
  FREE_GARDEN_LIMIT_REACHED,
  FREE_REMINDER_PLANT_LIMIT_REACHED,
  monetizationErrorCode,
} from "./monetizationErrors.js";

test("normalizeMonetizationStatus maps the authenticated status RPC shape", () => {
  assert.deepEqual(
    normalizeMonetizationStatus({
      tier: "free",
      billing_period: null,
      subscription_status: "inactive",
      partner_offers_enabled: false,
      included_credits: 0,
      purchased_credits: 2,
      free_monthly_available: true,
      available_credits: 3,
      garden_plant_count: 7,
      garden_plant_limit: 10,
      reminder_plant_count: 2,
      reminder_plant_limit: 3,
    }),
    {
      tier: "free",
      billingPeriod: null,
      subscriptionStatus: "inactive",
      partnerOffersEnabled: false,
      includedCredits: 0,
      purchasedCredits: 2,
      freeMonthlyAvailable: true,
      availableCredits: 3,
      gardenPlantCount: 7,
      gardenPlantLimit: 10,
      reminderPlantCount: 2,
      reminderPlantLimit: 3,
    }
  );
});

test("normalizeMonetizationStatus preserves unlimited Premium limits as null", () => {
  const status = normalizeMonetizationStatus({
    tier: "premium",
    billing_period: "annual",
    subscription_status: "active",
    included_credits: 50,
    purchased_credits: 0,
    available_credits: 50,
    garden_plant_count: 42,
    garden_plant_limit: null,
    reminder_plant_count: 12,
    reminder_plant_limit: null,
  });

  assert.equal(status.tier, "premium");
  assert.equal(status.gardenPlantLimit, null);
  assert.equal(status.reminderPlantLimit, null);
});

test("monetizationErrorCode recognizes the Free garden limit in Supabase messages", () => {
  assert.equal(
    monetizationErrorCode({ message: "Postgres error: " + FREE_GARDEN_LIMIT_REACHED }),
    FREE_GARDEN_LIMIT_REACHED
  );
});

test("monetizationErrorCode recognizes the Free reminder-plant limit in details", () => {
  assert.equal(
    monetizationErrorCode({ details: "trigger raised " + FREE_REMINDER_PLANT_LIMIT_REACHED }),
    FREE_REMINDER_PLANT_LIMIT_REACHED
  );
});

test("monetizationErrorCode ignores unrelated errors", () => {
  assert.equal(monetizationErrorCode({ message: "network unavailable" }), null);
});
