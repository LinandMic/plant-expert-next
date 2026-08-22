import { supabase } from "./supabaseClient";

function rowToZone(row) {
  return {
    id: row.id,
    userId: row.user_id,
    legacyId: row.legacy_id,
    name: row.name,
    exposure: row.exposure,
    orientation: row.orientation,
    wateringMode: row.watering_mode,
    wateringType: row.watering_type,
    wateringFrequencyDays: row.watering_frequency_days,
    wateringDurationMinutes: row.watering_duration_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchZones(userId) {
  if (!userId) throw new Error("fetchZones: userId requis");

  const { data, error } = await supabase
    .from("garden_zones")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToZone);
}

export async function insertZone(userId, zone) {
  if (!userId) throw new Error("insertZone: userId requis");

  const row = {
    user_id: userId,
    name: zone && zone.name ? String(zone.name).trim() : null,
    exposure: (zone && zone.exposure) || null,
    orientation: (zone && zone.orientation) || null,
    watering_mode: (zone && zone.wateringMode) || null,
    watering_type: (zone && zone.wateringType) || null,
    watering_frequency_days: (zone && zone.wateringFrequencyDays) || null,
    watering_duration_minutes: (zone && zone.wateringDurationMinutes) || null,
    legacy_id: (zone && zone.legacyId) || null,
  };

  const { data, error } = await supabase.from("garden_zones").insert(row).select().single();
  if (error) throw error;
  return rowToZone(data);
}

// Explicit whitelist: only these app-level keys are ever read off `patch`.
// `id` and `userId` are deliberately absent, so a patch object carrying
// either (even accidentally, e.g. via {...zone, name: "x"}) can never
// reassign a zone's identity or owner through this function — updateZone
// always scopes the write with .eq("id", zoneId).eq("user_id", userId)
// on top of this, but the whitelist means the payload itself is incapable
// of touching those columns in the first place.
const PATCHABLE_FIELDS = {
  name: "name",
  exposure: "exposure",
  orientation: "orientation",
  wateringMode: "watering_mode",
  wateringType: "watering_type",
  wateringFrequencyDays: "watering_frequency_days",
  wateringDurationMinutes: "watering_duration_minutes",
  legacyId: "legacy_id",
};

function buildPatchRow(patch) {
  const row = {};
  for (const [appKey, dbKey] of Object.entries(PATCHABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(patch, appKey)) {
      row[dbKey] = patch[appKey];
    }
  }
  if (row.name !== undefined) {
    row.name = row.name ? String(row.name).trim() : null;
  }
  return row;
}

export async function updateZone(userId, zoneId, patch) {
  if (!userId) throw new Error("updateZone: userId requis");
  if (!zoneId) throw new Error("updateZone: zoneId requis");

  const row = buildPatchRow(patch || {});

  const { data, error } = await supabase
    .from("garden_zones")
    .update(row)
    .eq("id", zoneId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return rowToZone(data);
}

export async function deleteZone(userId, zoneId) {
  if (!userId) throw new Error("deleteZone: userId requis");
  if (!zoneId) throw new Error("deleteZone: zoneId requis");

  // A bare .delete() (no .select()) reports { error: null } from
  // PostgREST/Supabase even when 0 rows matched — e.g. a stale zoneId, a
  // zone already deleted elsewhere, or an ownership/RLS mismatch — so the
  // caller could otherwise treat a no-op as a real success. Requesting the
  // deleted id(s) back is what makes 0 (or, defensively, >1, which should
  // never happen given zoneId is a primary key) a real thrown error instead.
  const { data, error } = await supabase
    .from("garden_zones")
    .delete()
    .eq("id", zoneId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;

  if (!data || data.length !== 1) {
    throw new Error("deleteZone: zone introuvable ou déjà supprimée");
  }
}
