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
    zone_id: localPlant.zoneId ?? null,
  };
  const createdAt = parseCreatedAt(localPlant.dateAjout);
  if (createdAt) row.created_at = createdAt;

  const { data, error } = await supabase.from("plants").insert(row).select().single();
  if (error) throw error;
  return data;
}

// insertCatalogPlant(userId, catalogPlant) -> plants row
// The "add a published Plant Finder plant to My Garden" path — entirely
// separate from insertPlant above (the AI-identification flow), which it
// never calls or modifies. Requires
// supabase/migrations/20260915100000_add_catalog_plant_link_v1.sql's three
// new columns (source/catalog_plant_id/taxon_id) to be applied live;
// insertPlant/the AI flow needs nothing from that migration and is
// unaffected either way (source defaults to 'ai_identification' for every
// row that migration doesn't explicitly mark 'catalog').
//
// No fake confidence score, no fake ai_data, no invented care data — per
// this round's explicit data rules. ai_data is simply omitted here so the
// column's own '{}'::jsonb default applies, exactly like confidence,
// category, plantation, usage, description and identification_status
// (none of which apply to an already-identified catalog plant) are left
// unset -> null.
//
// commonName/latinName/family are a deliberate snapshot, not a violation
// of "existing catalog traits remain reference data" — the My Garden list
// UI has no join back to plant_catalog/plant_taxa today (same as every
// AI-identified plant's own common_name/latin_name, which are themselves
// permanent, non-locale-reactive snapshots taken at identification time),
// so a name/family snapshot at add-time is required for the plant to
// display at all. catalogPlantId/taxonId are stored alongside specifically
// so canonical identity is NOT lost the way it would be with a free-text
// name alone.
export async function insertCatalogPlant(userId, catalogPlant) {
  const row = {
    user_id: userId,
    common_name: catalogPlant.commonName || null,
    latin_name: catalogPlant.latinName || null,
    family: catalogPlant.family || null,
    source: "catalog",
    catalog_plant_id: catalogPlant.catalogPlantId || null,
    taxon_id: catalogPlant.taxonId || null,
    zone_id: catalogPlant.zoneId || null,
  };

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

  // Catalog-sourced plants (source='catalog') carry a taxon_id/catalog_
  // plant_id but only a frozen common_name/image snapshot from add-time —
  // switching the UI's active locale would otherwise never update their
  // displayed name the way Plant Finder already does (it always reads
  // plant_common_names live). Two extra BATCHED queries (never one per
  // plant — no N+1, regardless of how many catalog-sourced plants exist)
  // fetch every preferred fr/en name and catalog image for every distinct
  // taxon_id/catalog_plant_id actually present in this garden, so the
  // caller can prefer these live values over the snapshot, falling back
  // to it only when nothing comes back (e.g. the catalog entry was since
  // removed). ai_identification rows never set taxon_id/catalog_plant_id,
  // so both maps are simply never consulted for them.
  const taxonIds = [...new Set((plants || []).map((p) => p.taxon_id).filter(Boolean))];
  const catalogPlantIds = [...new Set((plants || []).map((p) => p.catalog_plant_id).filter(Boolean))];

  const preferredNamesByTaxonId = new Map();
  if (taxonIds.length > 0) {
    const { data: commonNames, error: commonNamesError } = await supabase
      .from("plant_common_names")
      .select("taxon_id, name, locale")
      .in("taxon_id", taxonIds)
      .eq("is_preferred", true);
    if (commonNamesError) throw commonNamesError;
    for (const row of commonNames || []) {
      const entry = preferredNamesByTaxonId.get(row.taxon_id) || {};
      if (row.locale === "fr") entry.fr = row.name;
      if (row.locale === "en") entry.en = row.name;
      preferredNamesByTaxonId.set(row.taxon_id, entry);
    }
  }

  // plant_type travels the same way (never snapshotted into `category` at
  // add-time, which would have frozen it in whatever locale/wording was
  // active then, same problem as the name) — the raw DB value is returned
  // as-is; translating it to a label is the UI's job (plantTypeLabel),
  // exactly like Plant Finder already does.
  const catalogDataByCatalogId = new Map();
  if (catalogPlantIds.length > 0) {
    const { data: catalogRows, error: catalogError } = await supabase
      .from("plant_catalog")
      .select("id, image_url, image_alt, plant_type")
      .in("id", catalogPlantIds);
    if (catalogError) throw catalogError;
    for (const row of catalogRows || []) {
      catalogDataByCatalogId.set(row.id, { imageUrl: row.image_url, imageAlt: row.image_alt, plantType: row.plant_type });
    }
  }

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
      const catalogData = plant.catalog_plant_id ? catalogDataByCatalogId.get(plant.catalog_plant_id) : null;
      // A real uploaded photo (plant_photos) always wins when present —
      // this fallback only ever applies to a catalog-sourced plant that
      // has none, and reads the SAME already-public plant_catalog image
      // URL Plant Finder itself renders directly, never a new/duplicated
      // record in plant_photos.
      if (!imageUrl && catalogData && catalogData.imageUrl) imageUrl = catalogData.imageUrl;

      const preferredNames = (plant.taxon_id && preferredNamesByTaxonId.get(plant.taxon_id)) || {};

      return {
        plant: {
          ...plant,
          catalog_plant_type: catalogData ? catalogData.plantType : null,
          preferred_common_name_fr: preferredNames.fr ?? null,
          preferred_common_name_en: preferredNames.en ?? null,
        },
        imageUrl,
        imageAlt: catalogData ? catalogData.imageAlt : null,
      };
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

export async function updatePlantZone(userId, plantId, zoneId) {
  const { data, error } = await supabase
    .from("plants")
    .update({ zone_id: zoneId })
    .eq("id", plantId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
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
