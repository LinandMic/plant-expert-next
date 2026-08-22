import { writeFileSync } from "node:fs";

// The full trait vocabulary this benchmark measures coverage against
// (union of spec §6 and §7), regardless of whether any provider actually
// fills a given trait for a given run.
export const ALL_TRAITS = [
  "growth_form",
  "height_min_cm",
  "height_max_cm",
  "spread_min_cm",
  "spread_max_cm",
  "sun",
  "soil_moisture",
  "soil_ph_min",
  "soil_ph_max",
  "soil_texture",
  "min_temperature_c",
  "max_temperature_c",
  "hardiness_min",
  "hardiness_max",
  "evergreen",
  "flowering_months",
  "water_need",
  "drought_tolerance",
  "container_suitable",
  "edible",
  "pollinator_value",
  "growth_rate",
];

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function computeCoverage(normalized) {
  const total = normalized.length;
  return ALL_TRAITS.map((trait) => {
    let perenualFound = 0;
    let trefleFound = 0;
    for (const plant of normalized) {
      const entry = plant.traits[trait];
      if (!entry) continue;
      if (entry.observations.some((o) => o.provider === "perenual" && o.normalized_value !== null && o.normalized_value !== undefined)) {
        perenualFound++;
      }
      if (entry.observations.some((o) => o.provider === "trefle" && o.normalized_value !== null && o.normalized_value !== undefined)) {
        trefleFound++;
      }
    }
    return {
      trait,
      perenual_found: perenualFound,
      perenual_total: total,
      perenual_percent: total ? Math.round((perenualFound / total) * 100) : 0,
      trefle_found: trefleFound,
      trefle_total: total,
      trefle_percent: total ? Math.round((trefleFound / total) * 100) : 0,
    };
  });
}

export function writeCoverageCsv(normalized, outPath) {
  const rows = computeCoverage(normalized);
  const header = ["trait", "perenual_found", "perenual_total", "perenual_percent", "trefle_found", "trefle_total", "trefle_percent"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(","));
  }
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}
