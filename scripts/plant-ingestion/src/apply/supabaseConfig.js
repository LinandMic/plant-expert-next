// Layer C credentials loader. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// server/local-only secrets — this file must NEVER be imported from
// anything that ships to the browser (no page, no component, no lib/*
// module reachable from the Next.js client bundle imports this).
//
// Mirrors scripts/plant-benchmark/src/config.js's own contract: reads from
// the process environment first, falls back to an optional local env file
// that is never committed (see .gitignore), and never logs a value — only
// ever exposes booleans (hasUrl/hasServiceRoleKey) for status reporting.
// The raw secret strings are only ever returned to the caller that actually
// builds the Supabase client (supabaseAdminClient.js), never printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INGESTION_ROOT = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(INGESTION_ROOT, ".env.ingestion");

// Minimal KEY=VALUE parser — deliberately no `dotenv` dependency for two
// required keys. Never logs values. Absent file is not an error: the
// process' own environment (shell export, CI secret, etc.) still works.
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf8");
  const values = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileValues = loadEnvFile(ENV_FILE);

function readKey(name) {
  const value = (process.env[name] ?? fileValues[name] ?? "").trim();
  return value || null;
}

// getSupabaseConfig() -> { url, serviceRoleKey, hasUrl, hasServiceRoleKey }
// `url`/`serviceRoleKey` are the raw values (null if absent) — pass them
// straight to supabaseAdminClient.js, never to a log/console call. Every
// other caller (CLI status lines, reports) must use hasUrl/hasServiceRoleKey
// only.
export function getSupabaseConfig() {
  const url = readKey("SUPABASE_URL");
  const serviceRoleKey = readKey("SUPABASE_SERVICE_ROLE_KEY");
  return {
    url,
    serviceRoleKey,
    hasUrl: Boolean(url),
    hasServiceRoleKey: Boolean(serviceRoleKey),
  };
}
