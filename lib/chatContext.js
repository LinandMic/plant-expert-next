// Server-side context resolution for the ALMEO Conversational Assistant
// (pages/api/chat.js). V1 supports exactly three modes — see the V1 spec's
// "BOTANICAL / USER CONTEXT" section:
//   "general"        — no extra context beyond the user's own question.
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
// Deliberately NOT in V1 (see the spec): full-garden dump, garden-zone
// reasoning, reminders, weather. Adding any of those is a separate,
// later change — this module must not grow them speculatively.

const MAX_STRING_FIELD_LENGTH = 200;

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

// resolveChatContext({ admin, userId, rawContext }) -> { mode, plant?, identification?, error? }
// The single entry point pages/api/chat.js uses. `rawContext` is the
// client-supplied `context` field of the request body — entirely
// untrusted; only `mode` and (for "plant" mode) `plantId` are ever read
// from it as lookup keys, never as data itself.
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

  return { mode: "general" };
}
