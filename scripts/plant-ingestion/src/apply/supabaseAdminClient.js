// Builds a service_role Supabase client for Layer C only. This file must
// NEVER be imported by anything reachable from the Next.js client bundle —
// it is only ever run from a local/CI Node process via applyCli.js or
// verifyCli.js. service_role bypasses RLS entirely: it is deliberately kept
// out of lib/supabaseClient.js (the browser client) and out of every
// pages/*.js or components/*.js import graph.
import { createClient } from "@supabase/supabase-js";

// createSupabaseAdminClient({ url, serviceRoleKey }) -> SupabaseClient
// Throws if either value is missing — callers must have already checked
// hasUrl/hasServiceRoleKey via supabaseConfig.js and produced a clean STOP
// message before ever reaching this function; this is a defensive backstop,
// not the primary error path.
export function createSupabaseAdminClient({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new Error("createSupabaseAdminClient: url and serviceRoleKey are both required");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      // No browser storage exists in a Node script, and a service_role key
      // never needs a refreshed user session — both would be meaningless
      // (and would attempt disk/localStorage access) if left on defaults.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
