import { writeFileSync } from "node:fs";

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeTaxonomyCsv(normalized, outPath) {
  const header = [
    "input_name",
    "wcvp_accepted_name",
    "wcvp_status",
    "wcvp_taxon_id",
    "perenual_name",
    "perenual_match_type",
    "trefle_name",
    "trefle_match_type",
    "cultivar",
    "notes",
  ];
  const lines = [header.join(",")];

  for (const plant of normalized) {
    const notes = [];
    if (plant.providers.wcvp.not_found) notes.push("wcvp: not found");
    if (plant.providers.wcvp.error) notes.push(`wcvp: ${plant.providers.wcvp.error.message}`);
    if (plant.providers.perenual.status === "skipped_no_key") notes.push("perenual: no API key");
    if (plant.providers.perenual.status === "error") notes.push(`perenual: ${plant.providers.perenual.error && plant.providers.perenual.error.message}`);
    if (plant.providers.trefle.status === "skipped_no_key") notes.push("trefle: no API key");
    if (plant.providers.trefle.status === "error") notes.push(`trefle: ${plant.providers.trefle.error && plant.providers.trefle.error.message}`);

    const row = {
      input_name: plant.input_name,
      wcvp_accepted_name: plant.taxonomy.accepted_name,
      wcvp_status: plant.taxonomy.taxonomic_status,
      wcvp_taxon_id: plant.taxonomy.accepted_taxon_id,
      perenual_name: plant.providers.perenual.record ? plant.providers.perenual.record.scientific_name : null,
      perenual_match_type: plant.providers.perenual.match_type,
      trefle_name: plant.providers.trefle.record ? plant.providers.trefle.record.scientific_name : null,
      trefle_match_type: plant.providers.trefle.match_type,
      cultivar: plant.horticultural_identity.cultivar,
      notes: notes.join("; "),
    };
    lines.push(header.map((k) => csvEscape(row[k])).join(","));
  }

  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}
