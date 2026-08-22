import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Persists a raw provider response to raw/<providerDir>/<filename>.json for
// manual audit. `raw/` is gitignored — this never pollutes the repository.
export function writeRaw(rawRoot, providerDir, filename, payload) {
  const dir = path.join(rawRoot, providerDir);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${filename}.json`);
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}
