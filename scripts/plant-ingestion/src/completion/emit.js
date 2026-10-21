// Builds the local output files of a completion run. Pure: returns objects /
// strings; completionCli.js writes them. Nothing here touches Supabase.
//
// Outputs (Option A, no migration):
// - editorial-input.json  -> schema_version 2 entries for editorialCli.js
//   (one entry per (catalog_ref, trait); `source` = the institutional
//   source; the corroborating source goes, structured, in review.note)
// - common-names.json     -> common_names_batch_v1 rows for commonNamesCli.js
// - catalog-map.json      -> { catalog_entries: [{ catalog_ref, slug }] } for --catalog-map
// - report.json / report.md -> every decision, sources (URLs only), reasons,
//   spend and per-site blocking — never any copied page text
// - publish-candidates.sql -> NOT executed; explicit slug list + count guards

import { CURATION_LICENSE, COMPLETION_MODEL } from "./completionConfig.js";

const COLUMN_ORDER = ["plant_type", "sun", "height_min_cm", "height_max_cm", "spread_max_cm", "evergreen", "water_need", "flowering_months"];

function primaryAndCorroboration(sources) {
  const primary = sources.find((s) => s.institutional) || sources[0];
  const corroboration = sources.find((s) => s.domain !== primary.domain);
  return { primary, corroboration };
}

function corroborationText(s) {
  return `corroboration: ${s.publisher} | ${s.title ?? "(sans titre)"} | ${s.url} | ${s.retrieved_at ?? "date inconnue"}`;
}

// raw_value: our own short, factual summary of what each site states —
// never text copied from a page.
function rawValueSummary(column, decision) {
  const sites = decision.sources.map((s) => s.domain).join(" + ");
  return `${column} = ${JSON.stringify(decision.value)} (proposition IA + ${decision.sources.length} sources concordantes : ${sites})`;
}

export function buildEditorialEntries(plantResults, { generatedAt }) {
  const entries = [];
  for (const r of plantResults) {
    if (!r.decision) continue;
    for (const column of COLUMN_ORDER) {
      const d = r.decision.columns[column];
      if (!d || !d.emit) continue;
      const { primary, corroboration } = primaryAndCorroboration(d.sources);
      entries.push({
        schema_version: 2,
        catalog_ref: r.plant.catalog_ref,
        trait: column,
        raw_value: rawValueSummary(column, d),
        normalized_value: d.value,
        curation: { method: "open_source_synthesis", license: CURATION_LICENSE },
        source: {
          title: primary.title || `${r.plant.canonical_name} — ${primary.publisher}`,
          publisher: primary.publisher,
          url: primary.url,
          license: primary.license,
          retrieved_at: primary.retrieved_at || generatedAt,
        },
        review: {
          note: [
            `Complétion automatique (${generatedAt}) : valeur retenue car la proposition IA (${COMPLETION_MODEL}) et ${d.sources.length} sources ancrées de sites différents concordent.`,
            d.status === "existing_corrected" ? `Corrige la valeur existante ${JSON.stringify(d.existing)}.` : null,
            corroboration ? corroborationText(corroboration) : null,
            "Aucun texte reproduit.",
          ].filter(Boolean).join(" "),
          decided_by: null,
        },
        confidence: "high",
      });
    }
  }
  return entries;
}

export function buildCommonNamesBatch(plantResults, { generatedAt, lotId }) {
  const rows = [];
  const corroborations = [];
  for (const r of plantResults) {
    const d = r.decision?.common_name_fr;
    if (!d || !d.emit) continue;
    const { primary, corroboration } = primaryAndCorroboration(d.sources);
    rows.push({
      taxon_ref: r.plant.taxon_ref,
      canonical_name: r.plant.canonical_name,
      locale: "fr",
      name: d.value,
      is_preferred: true,
      source_url: primary.url,
      source_title: primary.title || `${r.plant.canonical_name} — ${primary.publisher}`,
      source_publisher: primary.publisher,
      curation_method: "open_source_synthesis",
      retrieved_at: primary.retrieved_at || generatedAt,
    });
    if (corroboration) corroborations.push({ taxon_ref: r.plant.taxon_ref, name: d.value, ...corroboration });
  }
  return {
    schema_version: "common_names_batch_v1",
    generated_at: generatedAt,
    purpose: `Completion lot ${lotId}: preferred French common names retained because the AI proposal and two grounded French sources (different sites, one institutional) agree. Corroborating sources are listed below and in report.json.`,
    not_applied: true,
    taxa_in_scope: rows.length,
    corroborating_sources: corroborations,
    rows,
  };
}

export function buildCatalogMap(plants) {
  return { mode: "completion_catalog_map", catalog_entries: plants.map((p) => ({ catalog_ref: p.catalog_ref, slug: p.slug })) };
}

export function buildPublishSql(plantResults, { lotId }) {
  const slugs = plantResults.filter((r) => r.decision?.publishable).map((r) => r.plant.slug).sort();
  const list = slugs.map((s) => `  ('${s.replace(/'/g, "''")}')`).join(",\n");
  return `-- =============================================================================
-- ÉCRITURE — NE PAS LANCER AVANT RELECTURE. Généré par la complétion, lot ${lotId}.
-- À lancer seulement APRÈS : editorialCli.js --apply puis --verify (valeurs
-- écrites et vérifiées), et commonNamesCli.js --apply si des noms FR sont ajoutés.
-- Publie uniquement les ${slugs.length} fiches dont les 4 critères critiques
-- (type, exposition, hauteur, envergure) sont vérifiés (IA + 2 sources ancrées).
-- Toute la transaction est annulée si le nombre de lignes ne correspond pas.
-- =============================================================================
${slugs.length === 0 ? "-- Aucune fiche publiable dans ce lot.\n" : `begin;

create temp table to_publish on commit drop as
select pc.id, pc.slug
from public.plant_catalog pc
join (values
${list}
) as wanted(slug) on wanted.slug = pc.slug
where pc.publication_status = 'draft';

do $$
declare expected constant int := ${slugs.length}; found int;
begin
  select count(*) into found from to_publish;
  if found <> expected then
    raise exception 'Attendu % fiches draft, trouvé % — transaction annulée.', expected, found;
  end if;
end $$;

update public.plant_catalog pc
set publication_status = 'published',
    review_status      = 'reviewed',
    published_at       = now(),
    updated_at         = now()
from to_publish tp
where pc.id = tp.id and pc.publication_status = 'draft';

do $$
declare expected constant int := ${slugs.length}; done int;
begin
  select count(*) into done from public.plant_catalog pc join to_publish tp on tp.id = pc.id
  where pc.publication_status = 'published';
  if done <> expected then
    raise exception 'Après mise à jour : % publiées au lieu de % — transaction annulée.', done, expected;
  end if;
end $$;

commit;
`}`;
}

// Per-site blocking statistics (fetches are what count as sources).
export function buildSiteStats(plantResults) {
  const stats = {};
  const bump = (domain, key) => {
    const d = domain || "(inconnu)";
    stats[d] = stats[d] || { fetch_ok: 0, fetch_blocked: 0, blocked_codes: {}, search_hits: 0, grounded_values: 0, rejected_passages: 0 };
    stats[d][key] += 1;
    return stats[d];
  };
  for (const r of plantResults) {
    for (const f of r.fetchLog || []) {
      const s = bump(f.domain, f.ok ? "fetch_ok" : "fetch_blocked");
      if (!f.ok) s.blocked_codes[f.error_code] = (s.blocked_codes[f.error_code] || 0) + 1;
    }
    for (const h of r.searchLog || []) if (h.ok && h.domain) bump(h.domain, "search_hits");
    for (const o of r.observations || []) bump(o.domain, "grounded_values");
    for (const x of r.rejected || []) bump(x.domain, "rejected_passages");
  }
  for (const s of Object.values(stats)) {
    const attempts = s.fetch_ok + s.fetch_blocked;
    s.fetch_block_rate = attempts ? Math.round((100 * s.fetch_blocked) / attempts) : null;
  }
  return stats;
}

export function buildReport(plantResults, { lotId, generatedAt, spend, budgetCapUsd, stoppedForBudget }) {
  return {
    lot_id: lotId,
    generated_at: generatedAt,
    model: COMPLETION_MODEL,
    budget_cap_usd: budgetCapUsd,
    spend,
    stopped_for_budget: stoppedForBudget,
    summary: {
      plants: plantResults.length,
      processed: plantResults.filter((r) => r.decision).length,
      publishable: plantResults.filter((r) => r.decision?.publishable).length,
      errors: plantResults.filter((r) => r.error).length,
      skipped: plantResults.filter((r) => r.skipped).length,
    },
    site_stats: buildSiteStats(plantResults),
    plants: plantResults.map((r) => ({
      slug: r.plant.slug,
      catalog_ref: r.plant.catalog_ref,
      canonical_name: r.plant.canonical_name,
      skipped: r.skipped ?? null,
      error: r.error ?? null,
      cost_usd: r.costUsd ?? 0,
      publishable: r.decision?.publishable ?? false,
      critical: r.decision?.critical ?? null,
      columns: r.decision?.columns ?? null,
      common_name_fr: r.decision?.common_name_fr ?? null,
      // parsed value of every grounded source (never the passage itself)
      source_values: r.observations ?? [],
      from_cache: r.fromCache ?? false,
      cached_request_changed: r.cachedRequestChanged ?? [],
      rejected_passages: r.rejected ?? [],
    })),
  };
}

const STATUS_FR = {
  verified: "✅ vérifié (nouveau)",
  existing_confirmed: "✅ existant confirmé",
  existing_corrected: "⚠️ existant corrigé",
  existing_unverified: "❓ existant non vérifié",
  to_verify: "❓ à vérifier",
  not_applicable: "— non applicable",
};

export function buildReportMarkdown(report) {
  const lines = [];
  lines.push(`# Complétion — lot ${report.lot_id}`, "");
  lines.push(`Généré le ${report.generated_at} · modèle ${report.model} · mode ${report.mode ?? "execute"} · dépense ${report.spend.usd.toFixed(2)} $ (plafond ${report.budget_cap_usd} $)${report.spend.reused_from_cache_usd_if_paid ? ` · réutilisé depuis le cache sans repayer : ${report.spend.reused_from_cache_usd_if_paid.toFixed(2)} $` : ""}${report.stopped_for_budget ? " · **arrêt sur plafond budgétaire**" : ""}`, "");
  lines.push(`**${report.summary.publishable} / ${report.summary.plants} fiches publiables** (4 critères critiques vérifiés) · erreurs : ${report.summary.errors} · non traitées : ${report.summary.skipped}`, "");
  lines.push("## Blocage par site", "", "| Site | Pages lues | Bloquées | Taux de blocage | Codes | Valeurs ancrées | Passages rejetés |", "|---|---|---|---|---|---|---|");
  for (const [domain, s] of Object.entries(report.site_stats)) {
    lines.push(`| ${domain} | ${s.fetch_ok} | ${s.fetch_blocked} | ${s.fetch_block_rate == null ? "—" : `${s.fetch_block_rate} %`} | ${Object.entries(s.blocked_codes).map(([k, v]) => `${k}×${v}`).join(", ") || "—"} | ${s.grounded_values} | ${s.rejected_passages} |`);
  }
  lines.push("");
  for (const p of report.plants) {
    lines.push(`## ${p.canonical_name} (\`${p.slug}\`) — ${p.publishable ? "**publiable**" : "non publiable"}`);
    if (p.skipped) lines.push(`Non traitée : ${p.skipped}`);
    if (p.error) lines.push(`Erreur : ${p.error}`);
    if (p.columns) {
      lines.push("", "| Critère | Statut | Valeur | Sources | Raisons |", "|---|---|---|---|---|");
      for (const [col, d] of Object.entries(p.columns)) {
        lines.push(`| ${col} | ${STATUS_FR[d.status] ?? d.status} | ${d.value == null ? (d.existing == null ? "—" : `(existant) ${JSON.stringify(d.existing)}`) : JSON.stringify(d.value)} | ${d.sources.map((s) => s.domain).join(", ") || "—"} | ${(d.reasons || []).join("; ") || ""} |`);
      }
      const n = p.common_name_fr;
      if (n) lines.push(`| nom FR préféré | ${STATUS_FR[n.status] ?? n.status} | ${n.value ?? n.existing ?? "—"} | ${n.sources.map((s) => s.domain).join(", ") || "—"} | ${(n.reasons || []).join("; ")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
