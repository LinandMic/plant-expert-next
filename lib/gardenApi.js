import { supabase } from "./supabaseClient";

const BUCKET = "plant-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const VALID_IDENTIFICATION_STATUSES = ["unreviewed", "confirmed", "rejected", "uncertain"];

// Mirrors the plants_identification_status_check constraint: anything that
// isn't one of the 4 allowed values (including undefined for non-photo
// flows) is stored as null rather than risking a raw Postgres error.
function sanitizeIdentificationStatus(status) {
  return VALID_IDENTIFICATION_STATUSES.includes(status) ? status : null;
}

function buildAiData(localPlant) {
  return {
    ...(localPlant.data || {}),
    _context: {
      legacy_id: localPlant.id,
      dateAjout: localPlant.dateAjout,
      plantation: localPlant.plantation || null,
      usage: localPlant.usage || null,
    },
  };
}

function parseCreatedAt(dateAjout) {
  const t = dateAjout ? Date.parse(dateAjout) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

// Duplicate-migration guard: looks up a plant previously migrated from the
// same localStorage entry (mon_jardin_v2 id), so a retry after a partial
// migration failure never re-inserts a plant that already made it across.
export async function findExistingByLegacyId(userId, legacyId) {
  const { data, error } = await supabase
    .from("plants")
    .select("*")
    .eq("user_id", userId)
    .eq("ai_data->_context->>legacy_id", String(legacyId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertPlant(userId, localPlant) {
  const identite = (localPlant.data && localPlant.data.identite) || {};
  const row = {
    user_id: userId,
    common_name: identite.nom_commun || null,
    latin_name: identite.nom_latin || null,
    family: identite.famille || null,
    category: identite.categorie || null,
    plantation: (localPlant.plantation && localPlant.plantation.id) || null,
    usage: (localPlant.usage && localPlant.usage.id) || null,
    description: identite.description || null,
    confidence: identite.confiance || null,
    ai_data: buildAiData(localPlant),
    identification_status: sanitizeIdentificationStatus(localPlant.identificationStatus),
  };
  const createdAt = parseCreatedAt(localPlant.dateAjout);
  if (createdAt) row.created_at = createdAt;

  const { data, error } = await supabase.from("plants").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function uploadPrimaryPhoto(userId, plantId, dataUrl) {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `${userId}/${plantId}/primary.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("plant_photos")
    .insert({ user_id: userId, plant_id: plantId, storage_path: path, is_primary: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createSignedPhotoUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function fetchGardenRows(userId) {
  const { data: plants, error } = await supabase
    .from("plants")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const { data: photos, error: photosError } = await supabase
    .from("plant_photos")
    .select("*")
    .eq("user_id", userId)
    .eq("is_primary", true);
  if (photosError) throw photosError;

  const photoByPlantId = new Map((photos || []).map((p) => [p.plant_id, p]));

  return Promise.all(
    (plants || []).map(async (plant) => {
      const photo = photoByPlantId.get(plant.id);
      let imageUrl = null;
      if (photo) {
        try {
          imageUrl = await createSignedPhotoUrl(photo.storage_path);
        } catch {
          imageUrl = null;
        }
      }
      return { plant, imageUrl };
    })
  );
}

function toPositiveIntOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toPositiveNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Mirrors the plants table's CHECK constraints client-side and enforces that
// non-automatic watering never leaves stale automatic-only values behind.
function contextToRow(context) {
  const watering = (context && context.watering) || {};
  const isAutomatic = watering.mode === "automatic";
  return {
    location: (context && context.location) || null,
    exposure: (context && context.exposure) || null,
    orientation: (context && context.orientation) || null,
    watering_mode: watering.mode || null,
    watering_type: isAutomatic ? (watering.type || null) : null,
    watering_frequency_days: isAutomatic ? toPositiveIntOrNull(watering.frequencyDays) : null,
    watering_duration_minutes: isAutomatic ? toPositiveIntOrNull(watering.durationMinutes) : null,
    watering_flow_lph: isAutomatic ? toPositiveNumberOrNull(watering.flowLph) : null,
    watering_emitter_count: isAutomatic ? toPositiveIntOrNull(watering.emitterCount) : null,
    updated_at: new Date().toISOString(),
  };
}

export async function updatePlantContext(userId, plantId, context) {
  const row = contextToRow(context);
  const { data, error } = await supabase
    .from("plants")
    .update(row)
    .eq("id", plantId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePlantCascade(userId, plantId) {
  const { data: photos, error: photosErr } = await supabase
    .from("plant_photos")
    .select("storage_path")
    .eq("plant_id", plantId)
    .eq("user_id", userId);
  if (photosErr) throw photosErr;

  if (photos && photos.length > 0) {
    const paths = photos.map((p) => p.storage_path);
    const { error: removeErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeErr) throw removeErr;
  }

  // plant_photos rows cascade automatically via the (plant_id, user_id) FK.
  const { error } = await supabase.from("plants").delete().eq("id", plantId).eq("user_id", userId);
  if (error) throw error;
}
