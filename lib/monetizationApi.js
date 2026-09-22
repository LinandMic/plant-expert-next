import { supabase } from "./supabaseClient";

export async function fetchMonetizationStatus() {
  if (!supabase) throw new Error("MONETIZATION_UNAVAILABLE");

  const { data, error } = await supabase.rpc("get_monetization_status");
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("MONETIZATION_STATE_MISSING");

  return {
    tier: data.tier === "premium" ? "premium" : "free",
    billingPeriod: data.billing_period ?? null,
    subscriptionStatus: data.subscription_status ?? "inactive",
    partnerOffersEnabled: Boolean(data.partner_offers_enabled),
    includedCredits: Number(data.included_credits) || 0,
    purchasedCredits: Number(data.purchased_credits) || 0,
    freeMonthlyAvailable: Boolean(data.free_monthly_available),
    availableCredits: Number(data.available_credits) || 0,
    gardenPlantCount: Number(data.garden_plant_count) || 0,
    gardenPlantLimit: data.garden_plant_limit == null ? null : Number(data.garden_plant_limit),
    reminderPlantCount: Number(data.reminder_plant_count) || 0,
    reminderPlantLimit: data.reminder_plant_limit == null ? null : Number(data.reminder_plant_limit),
  };
}
