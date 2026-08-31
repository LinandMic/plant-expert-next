import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(BENCHMARK_ROOT, ".env.benchmark");

// Minimal KEY=VALUE parser — deliberately no `dotenv` dependency for two
// optional keys. Never logs values. Absent file is not an error: the
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

export function getConfig() {
  const perenualApiKey = readKey("PERENUAL_API_KEY");
  const trefleApiKey = readKey("TREFLE_API_KEY");
  // Not a secret — documents which Perenual subscription tier the
  // configured key belongs to, so the benchmark can tell a genuinely empty
  // catalog search apart from a search that's merely invisible under a
  // restricted-catalog plan (see providers/perenual.js's
  // `unresolved_under_plan` handling). Left `null` (unknown) unless the
  // operator explicitly sets it — an unknown tier never triggers that
  // reclassification, it only ever affects Perenual `not_found` results.
  const perenualAccessTierRaw = readKey("PERENUAL_ACCESS_TIER");
  const perenualAccessTier = perenualAccessTierRaw ? perenualAccessTierRaw.toLowerCase() : null;
  return {
    benchmarkRoot: BENCHMARK_ROOT,
    perenualApiKey,
    trefleApiKey,
    hasPerenualKey: Boolean(perenualApiKey),
    hasTrefleKey: Boolean(trefleApiKey),
    perenualAccessTier,
  };
}
