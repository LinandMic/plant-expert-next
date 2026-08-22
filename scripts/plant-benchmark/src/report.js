import { writeFileSync } from "node:fs";
import { computeCoverage, computeExtraDiscoveredTraitCoverage, computeRecordCoverage, computeExactCultivarCoverage, BENCHMARK_TRAITS } from "./coverage.js";
import { computeContradictions } from "./contradictionsCsv.js";

function countBy(list) {
  const counts = {};
  for (const key of list) counts[key] = (counts[key] || 0) + 1;
  return counts;
}

const MATCHED_REASONS = new Set(["exact_scientific_match", "exact_cultivar_match"]);

export function writeReportMd(normalized, errors, config, outPath) {
  const total = normalized.length;
  const wcvpFound = normalized.filter((p) => p.taxonomy.accepted_name).length;
  const perenualMatched = normalized.filter((p) => MATCHED_REASONS.has(p.providers.perenual.selection_reason)).length;
  const trefleMatched = normalized.filter((p) => MATCHED_REASONS.has(p.providers.trefle.selection_reason)).length;
  const perenualParentOnly = normalized.filter((p) => p.providers.perenual.selection_reason === "parent_only").length;
  const trefleParentOnly = normalized.filter((p) => p.providers.trefle.selection_reason === "parent_only").length;
  const perenualAmbiguous = normalized.filter((p) => p.providers.perenual.selection_reason === "ambiguous").length;
  const trefleAmbiguous = normalized.filter((p) => p.providers.trefle.selection_reason === "ambiguous").length;

  const cultivarInputs = normalized.filter((p) => p.horticultural_identity.cultivar);
  const wcvpMatchTypes = normalized.flatMap((p) => [p.providers.perenual.wcvp_match_type, p.providers.trefle.wcvp_match_type].filter(Boolean));
  const wcvpMatchTypeCounts = countBy(wcvpMatchTypes);
  const synonymCount = wcvpMatchTypeCounts.synonym_match || 0;

  const contradictionRows = computeContradictions(normalized);
  const coverageRows = computeCoverage(normalized);
  const extraTraitRows = computeExtraDiscoveredTraitCoverage(normalized);
  const perenualRecordCoverage = computeRecordCoverage(normalized, "perenual");
  const trefleRecordCoverage = computeRecordCoverage(normalized, "trefle");
  const perenualCultivarCoverage = computeExactCultivarCoverage(normalized, "perenual");
  const trefleCultivarCoverage = computeExactCultivarCoverage(normalized, "trefle");

  const perenualErrors = errors.filter((e) => e.provider === "perenual");
  const trefleErrors = errors.filter((e) => e.provider === "trefle");
  const wcvpErrors = errors.filter((e) => e.provider === "wcvp");

  const cultivarLines = cultivarInputs.length
    ? cultivarInputs
        .map((p) => {
          const wcvp = p.providers.wcvp;
          const parent = wcvp.accepted_usage ? wcvp.accepted_usage.canonical_name : "(non résolu par WCVP)";
          const per = p.providers.perenual;
          const tre = p.providers.trefle;
          const perDesc = per.record ? `${per.selection_reason} (nom fournisseur "${per.record.scientific_name || "?"}"${per.record.cultivar_field ? `, champ cultivar="${per.record.cultivar_field}"` : ""})` : per.selection_reason;
          const treDesc = tre.record ? `${tre.selection_reason} (nom fournisseur "${tre.record.scientific_name || "?"}")` : tre.selection_reason;
          return `- **${p.input_name}** — parent WCVP : ${parent}. Perenual: ${perDesc}. Trefle: ${treDesc}.`;
        })
        .join("\n")
    : "_Aucun cultivar dans le panel exécuté._";

  function formatTraitBlocks(rows, provider) {
    if (!rows.length) return "_Aucune observation de trait collectée dans cette exécution (voir errors.json / selection_reason par plante)._";
    return rows
      .map((r) => {
        const found = r[`${provider}_found`];
        const condTotal = r[`${provider}_conditional_total`];
        const condPct = r[`${provider}_conditional_percent`];
        const e2eTotal = r[`${provider}_end_to_end_total`];
        const e2ePct = r[`${provider}_end_to_end_percent`];
        return `**${r.trait}**\n- ${found}/${condTotal} matched = ${condPct}% conditional coverage\n- ${found}/${e2eTotal} = ${e2ePct}% end-to-end coverage`;
      })
      .join("\n\n");
  }

  const perenualTraitBlocks = formatTraitBlocks(coverageRows, "perenual");
  const trefleTraitBlocks = formatTraitBlocks(coverageRows, "trefle");
  const perenualExtraTraitBlocks = extraTraitRows.length ? formatTraitBlocks(extraTraitRows, "perenual") : "_Aucun trait supplémentaire découvert hors BENCHMARK_TRAITS pour ce fournisseur dans cette exécution._";
  const trefleExtraTraitBlocks = extraTraitRows.length ? formatTraitBlocks(extraTraitRows, "trefle") : "_Aucun trait supplémentaire découvert hors BENCHMARK_TRAITS pour ce fournisseur dans cette exécution._";

  const contradictionLines = contradictionRows.length
    ? contradictionRows
        .map((r) => `- ${r.plant} / ${r.trait} : ${r.provider_a}=${r.value_a} vs ${r.provider_b}=${r.value_b} (écart ${r.difference}, sévérité ${r.severity})`)
        .join("\n")
    : "_Aucune contradiction significative détectée selon la règle ci-dessous (ou aucune paire d'observations numériques inter-fournisseurs à comparer)._";

  const matchTypeLines = Object.keys(wcvpMatchTypeCounts).length
    ? Object.entries(wcvpMatchTypeCounts).map(([k, v]) => `- ${k} : ${v}`).join("\n")
    : "_Aucune correspondance calculée — voir les erreurs ci-dessous._";

  const md = `# Plant Benchmark — Rapport

Généré le ${new Date().toISOString()}.

## Executive summary

- Plantes testées : ${total}
- Trouvées par WCVP : ${wcvpFound}/${total}
- Perenual — correspondance confiante (\`exact_scientific_match\`/\`exact_cultivar_match\`) : ${perenualMatched}/${total}${config.hasPerenualKey ? "" : " (clé API absente)"} · parent seul (\`parent_only\`) : ${perenualParentOnly} · ambigu : ${perenualAmbiguous}
- Trefle — correspondance confiante : ${trefleMatched}/${total}${config.hasTrefleKey ? "" : " (clé API absente)"} · parent seul (\`parent_only\`) : ${trefleParentOnly} · ambigu : ${trefleAmbiguous}
- Cultivars dans le panel : ${cultivarInputs.length}
- Correspondances classées \`synonym_match\` (nom fournisseur vs WCVP) : ${synonymCount}
- Contradictions numériques significatives détectées : ${contradictionRows.length}

**Rappel important** : un \`parent_only\` n'est jamais compté comme "cultivar trouvé", un \`ambiguous\` n'est jamais compté comme donnée fiable, une erreur réseau (\`provider_error\`) n'est jamais comptée comme "trait absent chez le fournisseur" — ces trois états sont distincts partout dans ce rapport et dans \`coverage.csv\`/\`taxonomy.csv\` (spec §22/§23).

## Taxonomy

Répartition des types de correspondance (nom retenu par Perenual/Trefle comparé au \`taxonomy\` résolu par WCVP — accepted_usage, jamais un synonyme présenté comme accepté) :

${matchTypeLines}

Voir \`taxonomy.csv\` pour le détail ligne par ligne — colonnes \`wcvp_queried_name\`/\`wcvp_accepted_name\` distinctes, y compris pour les entrées volontairement pensées pour tester la réconciliation de noms anciens/synonymes du panel (*Rosmarinus officinalis*, *Pennisetum alopecuroides*).

## Cultivars

${cultivarLines}

## Record & cultivar coverage

**Record coverage** : sur l'ensemble du panel (dénominateur = ${total}, jamais un sous-ensemble), combien de plantes ont obtenu un enregistrement exploitable de ce fournisseur (\`exact_scientific_match\`, \`exact_cultivar_match\`, \`parent_taxon_match\`, ou \`parent_only\`) — plus large que la "correspondance confiante" de l'Executive summary, qui exclut volontairement \`parent_taxon_match\`/\`parent_only\`.

**Exact cultivar coverage** : restreint aux ${cultivarInputs.length} entrée(s) du panel dont \`input_type === "cultivar"\` — combien ont obtenu un \`exact_cultivar_match\` réel. Un \`parent_only\` n'y compte jamais comme un cultivar trouvé (spec §13).

### Perenual

Record coverage: ${perenualRecordCoverage.found}/${perenualRecordCoverage.total} = ${perenualRecordCoverage.percent}%
Exact cultivar coverage: ${perenualCultivarCoverage.found}/${perenualCultivarCoverage.total} = ${perenualCultivarCoverage.percent}%

### Trefle

Record coverage: ${trefleRecordCoverage.found}/${trefleRecordCoverage.total} = ${trefleRecordCoverage.percent}%
Exact cultivar coverage: ${trefleCultivarCoverage.found}/${trefleCultivarCoverage.total} = ${trefleCultivarCoverage.percent}%

## Trait coverage

Traits canoniques (\`BENCHMARK_TRAITS\`, ${BENCHMARK_TRAITS.length} traits) : la liste que nous voulons évaluer pour le futur Plant Finder, fixée indépendamment de ce qu'un fournisseur donné retourne réellement — chaque trait apparaît toujours ci-dessous, y compris à 0%, même si aucun fournisseur ne l'a jamais rempli sur ce panel. Voir \`src/coverage.js\` pour la liste complète et la justification concept-par-concept.

Pour chaque trait, deux taux sont rapportés, jamais confondus (spec §22/23) :

- **conditional coverage** : parmi les plantes où ce fournisseur a produit un enregistrement exploitable (le dénominateur "record coverage" ci-dessus), quelle proportion porte ce trait.
- **end-to-end coverage** : sur l'ensemble du panel (${total} plantes), quelle proportion se retrouve avec ce trait chez ce fournisseur — inclut donc, sans le masquer, le manque à gagner dû aux enregistrements non exploitables (\`not_found\`/\`ambiguous\`/\`provider_error\`/\`skipped_no_key\`).

### Perenual

${perenualTraitBlocks}

### Trefle

${trefleTraitBlocks}

Détail complet, avec totaux exacts, dans \`coverage.csv\` (colonne \`trait_scope = benchmark_trait\`).

## Extra discovered traits

Traits réellement retournés par un fournisseur mais qui ne font PAS partie de \`BENCHMARK_TRAITS\` (ex. \`atmospheric_humidity\`/précipitations chez Trefle, \`soil\` générique chez Perenual) — gardés à part pour ne jamais élargir silencieusement la liste canonique fixe. Même format conditional/end-to-end que ci-dessus, pour audit.

### Perenual

${perenualExtraTraitBlocks}

### Trefle

${trefleExtraTraitBlocks}

Détail complet dans \`coverage.csv\` (colonne \`trait_scope = extra_discovered_trait\`).

## Contradictions

Règle de détection (documentée dans \`src/contradictions.js\`), appliquée uniquement ENTRE fournisseurs différents (jamais entre deux observations du même fournisseur pour des champs distincts, ex. \`growth.maximum_height\` vs \`specifications.maximum_height\` chez Trefle, qui restent visibles séparément dans \`normalized.json\` sans être comparées automatiquement) : deux observations numériques d'un même trait pour la même plante sont signalées si la plus grande vaut au moins 1,5× la plus petite, OU si l'écart absolu dépasse un seuil propre au trait. C'est une heuristique de repérage, pas un jugement botanique — les deux valeurs sont toujours conservées telles quelles, aucun fournisseur n'est présumé avoir raison.

${contradictionLines}

## Provenance & licensing

- **WCVP/GBIF** : dataset "World Checklist of Vascular Plants", publié par le Royal Botanic Gardens, Kew, distribué via GBIF (datasetKey \`f382f0ce-323a-4091-bb9f-add557f3a9a2\`). La licence exacte doit être relue sur la fiche du dataset GBIF au moment de l'usage réel — non ré-affirmée ici.
- **Perenual** : aucun champ de licence/attribution structuré n'a été observé dans les réponses de cette exécution — à confirmer sur perenual.com/docs/api avant tout usage.
- **Trefle** : la provenance est désormais conservée au niveau de l'enregistrement (\`providers.trefle.provenance.record_sources\` dans \`normalized.json\`, \`source_scope: "record"\`), **jamais** attribuée à un trait précis sans preuve explicite dans la réponse — correction appliquée dans cette révision (spec §10).

Aucune conclusion juridique sur l'usage commercial n'est faite ici — seules les informations réellement présentes dans les réponses obtenues sont rapportées.

## API quality

- **WCVP/GBIF** : ${wcvpFound}/${total} trouvées, ${wcvpErrors.length} erreur(s) réseau/HTTP enregistrée(s).
- **Perenual** : ${config.hasPerenualKey ? `${perenualMatched}/${total} correspondance(s) confiante(s), ${perenualErrors.length} erreur(s) réseau/HTTP.` : "non testé dans cette exécution (aucune clé API fournie)."}
- **Trefle** : ${config.hasTrefleKey ? `${trefleMatched}/${total} correspondance(s) confiante(s), ${trefleErrors.length} erreur(s) réseau/HTTP.` : "non testé dans cette exécution (aucune clé API fournie)."}

Détail structuré de chaque échec (fournisseur, statut HTTP, message, horodatage) dans \`output/errors.json\`. Détail du choix de candidat (scores, raisons) pour chaque plante dans \`providers.*.candidates\` de \`normalized.json\`.

## Recommendation

Basée exclusivement sur les résultats mesurés ci-dessus pour **cette exécution précise** — à relire après une exécution avec un accès réseau réel et des clés API valides si cette exécution en a été privée (voir README, section "Limites connues de l'exécution").

- **WCVP** : ${wcvpFound === total && total > 0 ? "couverture complète sur ce panel — rôle d'autorité taxonomique confirmé pour les cas testés." : wcvpFound > 0 ? `couverture partielle (${wcvpFound}/${total}) — rôle d'autorité taxonomique à confirmer sur un panel plus large avant de trancher.` : "aucune donnée exploitable obtenue dans cette exécution — impossible de conclure sur ce fournisseur, voir errors.json."}
- **Perenual** : ${perenualMatched > 0 ? `${perenualMatched}/${total} correspondances confiantes — évaluer son rôle horticole/cultivar sur la base du détail de coverage.csv et de la section Cultivars ci-dessus.` : "aucune correspondance confiante obtenue dans cette exécution — impossible de conclure sur ce fournisseur."}
- **Trefle** : ${trefleMatched > 0 ? `${trefleMatched}/${total} correspondances confiantes — évaluer son rôle de traits structurés/provenance sur la base du détail de coverage.csv.` : "aucune correspondance confiante obtenue dans cette exécution — impossible de conclure sur ce fournisseur."}

Ce rapport répond uniquement à « voilà ce que les données permettent réellement de construire » — aucune recommandation de schéma \`plant_catalog\` n'est faite ici.
`;

  writeFileSync(outPath, md, "utf8");
}
