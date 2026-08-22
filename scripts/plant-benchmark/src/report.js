import { writeFileSync } from "node:fs";
import { computeCoverage } from "./coverage.js";
import { computeContradictions } from "./contradictionsCsv.js";

function countBy(list) {
  const counts = {};
  for (const key of list) counts[key] = (counts[key] || 0) + 1;
  return counts;
}

export function writeReportMd(normalized, errors, config, outPath) {
  const total = normalized.length;
  const wcvpFound = normalized.filter((p) => p.taxonomy.accepted_name).length;
  const perenualFound = normalized.filter((p) => p.providers.perenual.status === "ok").length;
  const trefleFound = normalized.filter((p) => p.providers.trefle.status === "ok").length;

  const cultivarInputs = normalized.filter((p) => p.horticultural_identity.cultivar);
  const matchTypes = normalized.flatMap((p) => [p.providers.perenual.match_type, p.providers.trefle.match_type].filter(Boolean));
  const matchTypeCounts = countBy(matchTypes);
  const synonymCount = matchTypeCounts.synonym_match || 0;

  const contradictionRows = computeContradictions(normalized);
  const coverageRows = computeCoverage(normalized);

  const perenualErrors = errors.filter((e) => e.provider === "perenual");
  const trefleErrors = errors.filter((e) => e.provider === "trefle");
  const wcvpErrors = errors.filter((e) => e.provider === "wcvp");

  const cultivarLines = cultivarInputs.length
    ? cultivarInputs
        .map((p) => {
          const parent = p.taxonomy.accepted_name || "(non résolu par WCVP)";
          const per = p.providers.perenual;
          const tre = p.providers.trefle;
          return `- **${p.input_name}** — parent WCVP : ${parent}. Perenual: ${per.status}${per.record ? ` (nom fournisseur "${per.record.scientific_name || "?"}"${per.record.cultivar_field ? `, champ cultivar="${per.record.cultivar_field}"` : ", pas de champ cultivar identifié"})` : ""}. Trefle: ${tre.status}${tre.record ? ` (nom fournisseur "${tre.record.scientific_name || "?"}")` : ""}.`;
        })
        .join("\n")
    : "_Aucun cultivar dans le panel exécuté._";

  const coverageTable = coverageRows
    .map((r) => `| ${r.trait} | ${r.perenual_found}/${r.perenual_total} (${r.perenual_percent}%) | ${r.trefle_found}/${r.trefle_total} (${r.trefle_percent}%) |`)
    .join("\n");

  const contradictionLines = contradictionRows.length
    ? contradictionRows
        .map((r) => `- ${r.plant} / ${r.trait} : ${r.provider_a}=${r.value_a} vs ${r.provider_b}=${r.value_b} (écart ${r.difference}, sévérité ${r.severity})`)
        .join("\n")
    : "_Aucune contradiction significative détectée selon la règle ci-dessous (ou aucune paire d'observations numériques communes à comparer)._";

  const matchTypeLines = Object.keys(matchTypeCounts).length
    ? Object.entries(matchTypeCounts).map(([k, v]) => `- ${k} : ${v}`).join("\n")
    : "_Aucune correspondance calculée — voir les erreurs ci-dessous._";

  const md = `# Plant Benchmark — Rapport

Généré le ${new Date().toISOString()}.

## Executive summary

- Plantes testées : ${total}
- Trouvées par WCVP : ${wcvpFound}/${total}
- Trouvées par Perenual : ${perenualFound}/${total}${config.hasPerenualKey ? "" : " (clé API absente — aucune requête effectuée pour ce fournisseur)"}
- Trouvées par Trefle : ${trefleFound}/${total}${config.hasTrefleKey ? "" : " (clé API absente — aucune requête effectuée pour ce fournisseur)"}
- Cultivars dans le panel : ${cultivarInputs.length}
- Correspondances classées \`synonym_match\` : ${synonymCount}
- Contradictions numériques significatives détectées : ${contradictionRows.length}

## Taxonomy

Répartition des types de correspondance (Perenual + Trefle confondus) face à WCVP :

${matchTypeLines}

Voir \`taxonomy.csv\` pour le détail ligne par ligne, y compris les entrées volontairement pensées pour tester la réconciliation de noms anciens/synonymes du panel (*Rosmarinus officinalis*, *Pennisetum alopecuroides*).

## Cultivars

${cultivarLines}

## Trait coverage

| trait | perenual | trefle |
|---|---|---|
${coverageTable}

Détail complet, avec totaux exacts, dans \`coverage.csv\`.

## Contradictions

Règle de détection (documentée dans \`src/contradictions.js\`) : deux observations numériques d'un même trait pour la même plante sont signalées si la plus grande vaut au moins 1,5× la plus petite, OU si l'écart absolu dépasse un seuil propre au trait (ex. 50 cm pour les dimensions, 1 point de pH, 8°C pour les températures). C'est une heuristique de repérage, pas un jugement botanique — les deux valeurs sont toujours conservées telles quelles, aucun fournisseur n'est présumé avoir raison.

${contradictionLines}

## Provenance & licensing

- **WCVP/GBIF** : dataset "World Checklist of Vascular Plants", publié par le Royal Botanic Gardens, Kew, distribué via GBIF (datasetKey \`f382f0ce-323a-4091-bb9f-add557f3a9a2\`). La licence exacte doit être relue sur la fiche du dataset GBIF au moment de l'usage réel — non ré-affirmée ici pour éviter une conclusion juridique que ce script ne peut pas établir lui-même.
- **Perenual** : ${perenualFound > 0 ? "aucun champ de licence/attribution structuré n'a été observé dans les réponses de cette exécution — à confirmer sur perenual.com/docs/api avant tout usage." : "non interrogé avec succès dans cette exécution (clé absente ou service injoignable) — aucune information de licence disponible à rapporter."}
- **Trefle** : ${trefleFound > 0 ? `les réponses observées exposent (quand le champ \`sources\` est présent) une provenance par trait, conservée dans \`providers.trefle.provenance\` de \`normalized.json\` — ${trefleFound} plante(s) avec une réponse exploitable dans cette exécution.` : "non interrogé avec succès dans cette exécution (clé absente ou service injoignable) — aucune information de licence disponible à rapporter."}

Aucune conclusion juridique sur l'usage commercial n'est faite ici — seules les informations réellement présentes dans les réponses obtenues sont rapportées.

## API quality

- **WCVP/GBIF** : ${wcvpFound}/${total} trouvées, ${wcvpErrors.length} erreur(s) réseau/HTTP enregistrée(s).
- **Perenual** : ${config.hasPerenualKey ? `${perenualFound}/${total} trouvées, ${perenualErrors.length} erreur(s) réseau/HTTP enregistrée(s).` : "non testé dans cette exécution (aucune clé API fournie)."}
- **Trefle** : ${config.hasTrefleKey ? `${trefleFound}/${total} trouvées, ${trefleErrors.length} erreur(s) réseau/HTTP enregistrée(s).` : "non testé dans cette exécution (aucune clé API fournie)."}

Détail structuré de chaque échec (fournisseur, statut HTTP, message, horodatage) dans \`output/errors.json\`.

## Recommendation

Basée exclusivement sur les résultats mesurés ci-dessus pour **cette exécution précise** — à relire après une exécution avec un accès réseau réel et des clés API valides si cette exécution en a été privée (voir README, section "Limites connues de l'exécution").

- **WCVP** : ${wcvpFound === total && total > 0 ? "couverture complète sur ce panel — rôle d'autorité taxonomique confirmé pour les cas testés." : wcvpFound > 0 ? `couverture partielle (${wcvpFound}/${total}) — rôle d'autorité taxonomique à confirmer sur un panel plus large avant de trancher.` : "aucune donnée exploitable obtenue dans cette exécution — impossible de conclure sur ce fournisseur, voir errors.json."}
- **Perenual** : ${perenualFound > 0 ? `${perenualFound}/${total} trouvées — évaluer son rôle horticole/cultivar sur la base du détail de coverage.csv et de la section Cultivars ci-dessus.` : "aucune donnée exploitable obtenue dans cette exécution — impossible de conclure sur ce fournisseur."}
- **Trefle** : ${trefleFound > 0 ? `${trefleFound}/${total} trouvées — évaluer son rôle de traits structurés/provenance sur la base du détail de coverage.csv.` : "aucune donnée exploitable obtenue dans cette exécution — impossible de conclure sur ce fournisseur."}

Ce rapport répond uniquement à « voilà ce que les données permettent réellement de construire » — aucune recommandation de schéma \`plant_catalog\` n'est faite ici.
`;

  writeFileSync(outPath, md, "utf8");
}
