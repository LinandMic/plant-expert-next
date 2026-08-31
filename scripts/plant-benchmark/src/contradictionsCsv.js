import { writeFileSync } from "node:fs";
import { detectContradiction } from "./contradictions.js";

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function computeContradictions(normalized) {
  const rows = [];
  for (const plant of normalized) {
    for (const [traitName, entry] of Object.entries(plant.traits)) {
      const numericObs = entry.observations.filter((o) => typeof o.normalized_value === "number");
      for (let i = 0; i < numericObs.length; i++) {
        for (let j = i + 1; j < numericObs.length; j++) {
          const a = numericObs[i];
          const b = numericObs[j];
          if (a.provider === b.provider) continue;
          const result = detectContradiction(traitName, a.normalized_value, b.normalized_value);
          if (!result) continue;
          rows.push({
            plant: plant.input_name,
            trait: traitName,
            provider_a: a.provider,
            value_a: a.normalized_value,
            provider_b: b.provider,
            value_b: b.normalized_value,
            difference: result.difference,
            severity: result.severity,
            notes: "seuil: ratio>=1.5 ou ecart absolu>=seuil du trait (voir src/contradictions.js)",
          });
        }
      }
    }
  }
  return rows;
}

export function writeContradictionsCsv(normalized, outPath) {
  const rows = computeContradictions(normalized);
  const header = ["plant", "trait", "provider_a", "value_a", "provider_b", "value_b", "difference", "severity", "notes"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(","));
  }
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}
