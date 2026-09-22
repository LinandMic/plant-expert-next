// Server-only Supabase admin (service_role) client for Almeo's Next.js API
// routes. Mirrors scripts/plant-ingestion/src/apply/supabaseAdminClient.js's
// contract (service_role bypasses RLS entirely) but is scoped to
// pages/api/** server handlers instead of a standalone CLI script.
//
// MUST NEVER be imported from anything reachable from the Next.js client
// bundle — no page, no component, no lib/* module that ships to the
// browser. Only pages/api/account/delete.js (a server-only Next.js API
// route handler, never bundled client-side) imports this today.
import { createClient } from "@supabase/supabase-js";

// createSupabaseAdminClient({ url, serviceRoleKey }) -> SupabaseClient
// Throws if either value is missing — callers must have already checked
// hasUrl/hasServiceRoleKey via getSupabaseAdminConfig() and produced a
// clean error response before ever reaching this function; this is a
// defensive backstop, not the primary error path.
export function createSupabaseAdminClient({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new Error("createSupabaseAdminClient: url and serviceRoleKey are both required");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      // No browser storage exists in a server/serverless request handler,
      // and a service_role key never needs a refreshed user session —
      // both would be meaningless (and could attempt disk/localStorage
      // access) if left on defaults.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// getSupabaseAdminConfig() -> { url, serviceRoleKey, hasUrl, hasServiceRoleKey }
// Reuses the same project URL already public via lib/supabaseClient.js's
// NEXT_PUBLIC_SUPABASE_URL (a Supabase project URL is an identifier, not a
// secret — only the key is) paired with the server-only
// SUPABASE_SERVICE_ROLE_KEY, which must never be exposed as NEXT_PUBLIC_*
// and must be configured in Vercel's server-only environment variables.
export function getSupabaseAdminConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim() || null;
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() || null;
  return {
    url,
    serviceRoleKey,
    hasUrl: Boolean(url),
    hasServiceRoleKey: Boolean(serviceRoleKey),
  };
}
