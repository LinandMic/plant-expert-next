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
  return {
    benchmarkRoot: BENCHMARK_ROOT,
    perenualApiKey,
    trefleApiKey,
    hasPerenualKey: Boolean(perenualApiKey),
    hasTrefleKey: Boolean(trefleApiKey),
  };
}
