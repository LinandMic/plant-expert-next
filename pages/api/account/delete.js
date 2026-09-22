// Server-side "Delete my account" endpoint for ALMEO (App Store / Google
// Play account-deletion compliance).
//
// Relative imports (not the "@/" alias used elsewhere): this file is
// loaded directly by plain `node --test` via lib/accountDeleteHandler.test.js,
// which only understands Node's native ESM resolution, not the Next.js/TS
// path alias — same reasoning as pages/api/proxy.js's own relative import.
//
// SECURITY MODEL (see the account-deletion report for the schema
// inspection this is based on):
//  - The caller identifies itself with a Supabase access token
//    (Authorization: Bearer <token>) — the authenticated user id is
//    derived EXCLUSIVELY from that verified token via admin.auth.getUser().
//    The request body is never read for identity; no client-supplied
//    userId is ever accepted, so one user can never target another's
//    account.
//  - Privileged cleanup (storage removal, auth-user deletion) runs only
//    server-side via a service_role client (lib/supabaseAdmin.js). The
//    service_role key never reaches the browser or a native asset.
//  - Every per-user Postgres table (profiles, plants, garden_zones,
//    plant_reminders, plant_photos) has an ON DELETE CASCADE foreign key
//    to auth.users (confirmed against the live schema via
//    pg_constraint/confdeltype — not assumed from the README). Deleting
//    the auth user therefore atomically removes every one of those rows
//    in a single Postgres transaction — safer than issuing separate
//    DELETEs from here, which could partially fail. Shared botanical/
//    catalog tables (plant_catalog, plant_taxa, plant_common_names,
//    plant_taxon_names, plant_source_records, plant_trait_observations,
//    plant_trait_selections) have NO cascade from auth.users (their only
//    auth.users FKs — curated_by/reviewed_by/decided_by — are ON DELETE
//    SET NULL) and are never targeted by this handler at all.
//  - Supabase Storage is a separate system from Postgres and is never
//    touched by any FK cascade, so storage objects are deleted FIRST,
//    explicitly, by exact storage_path rows the DB itself recorded for
//    this user (never an inferred/guessed path, never a bucket-wide
//    delete). Only after that succeeds is the auth user deleted, and only
//    then does the DB-side cascade run. If storage cleanup fails, the
//    auth user is deliberately left intact and an explicit error is
//    returned — an auth user is never deleted while cleanup failed
//    silently.
//  - Retry-safety: Storage removal of an already-missing object is not an
//    error (Supabase Storage's remove() is idempotent per-path), so a
//    retried request after a prior partial failure is safe. If the auth
//    deletion step itself fails after storage was already removed, a
//    retry simply re-lists the same (still-existing) plant_photos rows,
//    finds their storage objects already gone (no-op), and retries the
//    auth deletion — no manual reconciliation needed.
import { classifyOrigin, isSameOriginReferer } from "../../../lib/apiOrigin.js";
import { createSupabaseAdminClient, getSupabaseAdminConfig } from "../../../lib/supabaseAdmin.js";

const BUCKET = "plant-photos";
const CORS_ALLOWED_METHODS = "POST";
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization";

function defaultGetAdminClient() {
  const config = getSupabaseAdminConfig();
  if (!config.hasUrl || !config.hasServiceRoleKey) {
    throw new Error(
      "Supabase admin credentials are not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return createSupabaseAdminClient(config);
}

export function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match ? match[1].trim() : "";
  return token || null;
}

// createAccountDeleteHandler({ getAdminClient }) -> Next.js API handler.
// Injectable admin-client factory so this handler's actual logic (origin
// checks, auth, deletion order, error handling) can be unit tested against
// a fake Supabase client with zero real network calls and no real
// credentials — see lib/accountDeleteHandler.test.js. The default export
// below is the real, production-wired handler.
export function createAccountDeleteHandler({ getAdminClient = defaultGetAdminClient } = {}) {
  return async function handler(req, res) {
    const host = req.headers.host;
    const originHeader = req.headers.origin;
    const originClass = classifyOrigin(originHeader, host);

    // Same CORS policy as pages/api/proxy.js: only Almeo's own native app
    // shells are cross-origin callers by design, so only that class ever
    // gets CORS headers, always the exact request origin, never `*`.
    if (originClass === "native") {
      res.setHeader("Access-Control-Allow-Origin", originHeader);
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      if (originClass === "native") {
        res.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
        res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
      }
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const isAllowedOrigin =
      originClass === "native" ||
      originClass === "same-origin" ||
      (!originHeader && isSameOriginReferer(req.headers.referer, host));

    if (!isAllowedOrigin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    let admin;
    try {
      admin = getAdminClient();
    } catch (error) {
      console.error("account/delete: admin client unavailable:", error.message);
      return res.status(500).json({ error: "Account deletion is not available right now." });
    }

    // The authenticated user id comes ONLY from the verified token. The
    // request body is never read here — there is no body field that could
    // ever name a different user.
    let userId;
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data || !data.user) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      userId = data.user.id;
    } catch (error) {
      console.error("account/delete: token verification failed:", error.message);
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    // Step 1: list this user's own storage paths, filtered by the
    // server-verified user id only.
    let storagePaths;
    try {
      const { data, error } = await admin.from("plant_photos").select("storage_path").eq("user_id", userId);
      if (error) throw error;
      storagePaths = (data || [])
        .map((row) => row.storage_path)
        .filter((path) => typeof path === "string" && path.length > 0);
    } catch (error) {
      console.error("account/delete: failed to list storage paths:", error.message);
      return res.status(500).json({ error: "Account deletion failed. Please try again." });
    }

    // Step 2: delete storage objects. Never a bucket-wide delete, never an
    // inferred path — only the exact storage_path values the DB itself
    // recorded for this user. Must succeed before the auth user is ever
    // touched.
    if (storagePaths.length > 0) {
      try {
        const { error } = await admin.storage.from(BUCKET).remove(storagePaths);
        if (error) throw error;
      } catch (error) {
        console.error("account/delete: failed to remove storage objects:", error.message);
        return res.status(500).json({ error: "Account deletion failed. Please try again." });
      }
    }

    // Step 3: delete the auth user LAST, only after storage cleanup
    // succeeded. This cascades (see the module comment) to remove every
    // remaining per-user row atomically; shared catalog/reference tables
    // are never targeted.
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    } catch (error) {
      console.error("account/delete: failed to delete auth user:", error.message);
      return res.status(500).json({
        error:
          "Account deletion could not be completed. Please try again — your photos have already been removed but your account was not deleted.",
      });
    }

    return res.status(200).json({ success: true });
  };
}

export default createAccountDeleteHandler();
