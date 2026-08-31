import { writeFileSync } from "node:fs";

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeTaxonomyCsv(normalized, outPath) {
  const header = [
    "input_name",
    "wcvp_queried_name",
    "wcvp_queried_status",
    "wcvp_accepted_name",
    "wcvp_accepted_status",
    "wcvp_taxon_id",
    "wcvp_selection_reason",
    "perenual_name",
    "perenual_selection_reason",
    "perenual_wcvp_match_type",
    "trefle_name",
    "trefle_selection_reason",
    "trefle_wcvp_match_type",
    "cultivar",
    "notes",
  ];
  const lines = [header.join(",")];

  for (const plant of normalized) {
    const wcvp = plant.providers.wcvp;
    const notes = [];
    if (wcvp.not_found) notes.push("wcvp: not found");
    if (wcvp.error) notes.push(`wcvp: ${wcvp.error.message}`);
    if (plant.providers.perenual.status === "skipped_no_key") notes.push("perenual: no API key");
    if (plant.providers.perenual.selection_reason === "plan_restricted") notes.push("perenual: plan restricted (subscription upgrade required, not a botanical not_found)");
    if (plant.providers.perenual.selection_reason === "unresolved_under_plan") notes.push("perenual: unresolved under configured access tier (empty search under a documented limited-catalog plan — absence not established)");
    if (plant.providers.perenual.error) notes.push(`perenual: ${plant.providers.perenual.error.message}`);
    if (plant.providers.trefle.status === "skipped_no_key") notes.push("trefle: no API key");
    if (plant.providers.trefle.selection_reason === "plan_restricted") notes.push("trefle: plan restricted (subscription upgrade required, not a botanical not_found)");
    if (plant.providers.trefle.error) notes.push(`trefle: ${plant.providers.trefle.error.message}`);
    if (plant.traits_scope === "parent_only") notes.push("traits scoped to the parent species, not the cultivar");

    const row = {
      input_name: plant.input_name,
      wcvp_queried_name: wcvp.queried_usage ? wcvp.queried_usage.canonical_name : null,
      wcvp_queried_status: wcvp.queried_usage ? wcvp.queried_usage.taxonomic_status : null,
      wcvp_accepted_name: wcvp.accepted_usage ? wcvp.accepted_usage.canonical_name : null,
      wcvp_accepted_status: wcvp.accepted_usage ? wcvp.accepted_usage.taxonomic_status : null,
      wcvp_taxon_id: plant.taxonomy.accepted_taxon_id,
      wcvp_selection_reason: wcvp.selection_reason,
      perenual_name: plant.providers.perenual.record ? plant.providers.perenual.record.scientific_name : null,
      perenual_selection_reason: plant.providers.perenual.selection_reason,
      perenual_wcvp_match_type: plant.providers.perenual.wcvp_match_type,
      trefle_name: plant.providers.trefle.record ? plant.providers.trefle.record.scientific_name : null,
      trefle_selection_reason: plant.providers.trefle.selection_reason,
      trefle_wcvp_match_type: plant.providers.trefle.wcvp_match_type,
      cultivar: plant.horticultural_identity.cultivar,
      notes: notes.join("; "),
    };
    lines.push(header.map((k) => csvEscape(row[k])).join(","));
  }

  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}
