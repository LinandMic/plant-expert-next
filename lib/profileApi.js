import { supabase } from "./supabaseClient";

function buildDisplayName(firstName, lastName) {
  const parts = [firstName, lastName].map((s) => (s || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, country, region, city, space_type")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, fields) {
  const row = {
    first_name: fields.first_name ? fields.first_name.trim() : null,
    last_name: fields.last_name ? fields.last_name.trim() : null,
    country: fields.country ? fields.country.trim() : null,
    region: fields.region ? fields.region.trim() : null,
    city: fields.city ? fields.city.trim() : null,
    space_type: fields.space_type || null,
    updated_at: new Date().toISOString(),
  };

  // Keep display_name usable for compatibility, but only touch it when we
  // actually have a first/last name to build it from — never overwrite an
  // existing display_name with null just because this form was saved empty.
  const displayName = buildDisplayName(fields.first_name, fields.last_name);
  if (displayName) row.display_name = displayName;

  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
