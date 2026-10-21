// Resolves ANTHROPIC_API_KEY from the environment or from
// scripts/plant-ingestion/.env.ingestion (same file, same parsing rules and
// same "never print a secret" contract as apply/supabaseConfig.js). Only a
// boolean presence flag is ever reported.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(path.resolve(__dirname, "..", ".."), ".env.ingestion");

function readFromEnvFile(filePath, name) {
  if (!existsSync(filePath)) return null;
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value || null;
  }
  return null;
}

export function getAnthropicConfig({ env = process.env, envFile = ENV_FILE } = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || "").trim() || readFromEnvFile(envFile, "ANTHROPIC_API_KEY");
  return { apiKey: apiKey || null, hasApiKey: Boolean(apiKey) };
}
