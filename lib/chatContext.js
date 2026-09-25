// Server-side context resolution for the ALMEO Conversational Assistant
// (pages/api/chat.js). Supports three modes:
//   "general"        — bounded, server-derived garden context (the
//                       user's own plants/zones/due reminders/profile
//                       location — see resolveGeneralContext below).
//   "plant"          — an existing garden plant, identified ONLY by id.
//                       The row is fetched here, server-side, scoped to
//                       the authenticated caller — the client is never
//                       trusted for plant data, only for which plant id
//                       to look up.
//   "identification" — a fresh, UNSAVED identification result. The
//                       client necessarily holds this data (it was never
//                       saved anywhere), so it is treated as untrusted
//                       input: every field is whitelisted/validated here,
//                       and the original AI JSON blob is never forwarded.
//
// Still deliberately NOT included in "general": live weather (would add
// an external network call — and its own failure/timeout surface — to
// every general-mode chat turn; see docs/ai-chat-general-context.md-style
// reasoning in the PR that added this). Adding it is a separate, later
// change.

const MAX_STRING_FIELD_LENGTH = 200;
const MAX_GENERAL_PLANTS = 25;
const MAX_GENERAL_ZONES = 15;
const MAX_GENERAL_REMINDERS = 20;

function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_STRING_FIELD_LENGTH);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// resolveIdentificationContext(raw) -> { commonName, latinName, category,
// plantationLabel, usageLabel } | null
// Whitelists exactly the fields the V1 spec names for a fresh,
// unsaved identification — nothing else from the client's payload is
// ever read, and the original per-analysis AI JSON is never accepted
// here at all (the client only ever has the small derived fields to send
// in the first place).
export function resolveIdentificationContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const commonName = cleanString(raw.commonName);
  const latinName = cleanString(raw.latinName);
  const category = cleanString(raw.category);
  const plantationLabel = cleanString(raw.plantationLabel);
  const usageLabel = cleanString(raw.usageLabel);
  if (!commonName && !latinName) return null;
  return { commonName, latinName, category, plantationLabel, usageLabel };
}

// resolvePlantContext(admin, userId, plantId) -> { plant fields } | { error: "NOT_FOUND" }
// Fetches a garden plant server-side, scoped explicitly to the
// authenticated caller. `admin` is a service-role client, which BYPASSES
// RLS entirely — the `.eq("user_id", userId)` filter below is therefore
// the only thing preventing user A from reading user B's plant by id,
// and must never be dropped (same pattern pages/api/account/delete.js
// already uses for its own service-role reads).
export async function resolvePlantContext(admin, userId, plantId) {
  if (!isUuid(plantId)) return { error: "INVALID_PLANT_ID" };

  const { data: plant, error } = await admin
    .from("plants")
    .select(
      "id, common_name, latin_name, family, category, location, exposure, orientation, watering_mode, watering_type, watering_frequency_days, catalog_plant_id"
    )
    .eq("id", plantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!plant) return { error: "NOT_FOUND" };

  let catalogPlantType = null;
  if (plant.catalog_plant_id) {
    const { data: catalogRow, error: catalogError } = await admin
      .from("plant_catalog")
      .select("plant_type")
      .eq("id", plant.catalog_plant_id)
      .maybeSingle();
    if (catalogError) throw catalogError;
    catalogPlantType = (catalogRow && catalogRow.plant_type) || null;
  }

  return {
    plant: {
      commonName: plant.common_name || null,
      latinName: plant.latin_name || null,
      family: plant.family || null,
      category: plant.category || catalogPlantType || null,
      location: plant.location || null,
      exposure: plant.exposure || null,
      orientation: plant.orientation || null,
      wateringMode: plant.watering_mode || null,
      wateringType: plant.watering_type || null,
      wateringFrequencyDays: plant.watering_frequency_days || null,
    },
  };
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// resolveGeneralContext(admin, userId) -> { plantCount, plants, zones,
// reminders, location }
// The ONLY data source for "general" mode — every query below is
// explicitly scoped with `.eq("user_id"/"id", userId)`. `admin` is a
// service-role client that BYPASSES RLS entirely, so these filters (not
// RLS) are what prevents one user's context leaking into another's
// conversation — same pattern as resolvePlantContext above. `userId`
// comes only from the caller's verified Supabase token (see
// pages/api/chat.js) — this function never reads a client-supplied id.
//
// Bounded and compact by construction: each list is capped at a small
// constant (MAX_GENERAL_*), only a curated column list is selected per
// table (never `ai_data`/`note`/other free-form blobs), and every free-
// text field is passed through cleanString's 200-char truncation before
// it can reach the prompt. This is a summary for the assistant, not a
// database dump.
export async function resolveGeneralContext(admin, userId) {
  const today = todayISODate();

  const [plantsResult, zonesResult, remindersResult, profileResult] = await Promise.all([
    admin
      .from("plants")
      .select("id, common_name, latin_name, category, location, zone_id")
      .eq("user_id", userId)
      .limit(MAX_GENERAL_PLANTS),
    admin
      .from("garden_zones")
      .select("id, name, exposure, orientation")
      .eq("user_id", userId)
      .limit(MAX_GENERAL_ZONES),
    admin
      .from("plant_reminders")
      .select("plant_id, type, next_due_date")
      .eq("user_id", userId)
      .eq("is_active", true)
      .in("status", ["pending", "snoozed"])
      .lte("next_due_date", today)
      .order("next_due_date", { ascending: true })
      .limit(MAX_GENERAL_REMINDERS),
    admin.from("profiles").select("city, region, country").eq("id", userId).maybeSingle(),
  ]);

  if (plantsResult.error) throw plantsResult.error;
  if (zonesResult.error) throw zonesResult.error;
  if (remindersResult.error) throw remindersResult.error;
  if (profileResult.error) throw profileResult.error;

  const rawPlants = plantsResult.data || [];
  const rawZones = zonesResult.data || [];
  const rawReminders = remindersResult.data || [];

  const zoneNameById = new Map(rawZones.map((z) => [z.id, cleanString(z.name)]));

  const plants = rawPlants.map((p) => ({
    commonName: cleanString(p.common_name),
    latinName: cleanString(p.latin_name),
    category: cleanString(p.category),
    location: cleanString(p.location),
    zoneName: p.zone_id ? zoneNameById.get(p.zone_id) || null : null,
  }));

  const plantNameById = new Map(rawPlants.map((p) => [p.id, cleanString(p.common_name) || cleanString(p.latin_name)]));

  const reminders = rawReminders.map((r) => ({
    plantName: plantNameById.get(r.plant_id) || null,
    type: r.type,
    overdue: typeof r.next_due_date === "string" && r.next_due_date < today,
  }));

  const zones = rawZones.map((z) => ({
    name: cleanString(z.name),
    exposure: z.exposure || null,
    orientation: z.orientation || null,
  }));

  const profile = profileResult.data || null;
  const location =
    profile && (profile.city || profile.region || profile.country)
      ? { city: cleanString(profile.city), region: cleanString(profile.region), country: cleanString(profile.country) }
      : null;

  return {
    plantCount: plants.length,
    plants,
    zones,
    reminders,
    location,
  };
}

// resolveChatContext({ admin, userId, rawContext }) -> { mode, plant?, identification?, general?, error? }
// The single entry point pages/api/chat.js uses. `rawContext` is the
// client-supplied `context` field of the request body — entirely
// untrusted; only `mode` and (for "plant" mode) `plantId` are ever read
// from it as lookup keys, never as data itself. "general" mode reads no
// field from `rawContext` at all — its context comes exclusively from
// resolveGeneralContext(admin, userId) above.
export async function resolveChatContext({ admin, userId, rawContext }) {
  const mode =
    rawContext && typeof rawContext === "object" && typeof rawContext.mode === "string" ? rawContext.mode : "general";

  if (mode === "plant") {
    const plantId = rawContext.plantId;
    const result = await resolvePlantContext(admin, userId, plantId);
    if (result.error) return { mode: "plant", error: result.error };
    return { mode: "plant", plant: result.plant };
  }

  if (mode === "identification") {
    const identification = resolveIdentificationContext(rawContext.identification);
    if (!identification) return { mode: "identification", error: "INVALID_IDENTIFICATION_CONTEXT" };
    return { mode: "identification", identification };
  }

  const general = await resolveGeneralContext(admin, userId);
  return { mode: "general", general };
}
