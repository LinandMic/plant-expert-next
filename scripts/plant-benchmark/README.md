# Plant Benchmark (outil isolé, local uniquement)

Benchmark technique comparant 3 sources botaniques (WCVP via GBIF, Perenual,
Trefle) sur un panel d'environ 20 plantes, pour mesurer objectivement ce que
ces sources fournissent réellement avant de concevoir le futur schéma
Supabase `plant_catalog`.

**Ne touche à rien du reste de l'application.** Aucune table, aucune
migration, aucun appel Supabase, aucune Edge Function. Fonctionne
entièrement en local, en lecture seule vis-à-vis d'APIs tierces publiques.

## 1. Où créer le fichier local de variables d'environnement

Copier l'exemple fourni :

```bash
cp scripts/plant-benchmark/.env.benchmark.example scripts/plant-benchmark/.env.benchmark
```

Puis éditer `scripts/plant-benchmark/.env.benchmark` (jamais commité — déjà
couvert par la règle `.env*` du `.gitignore` racine du projet).

## 2. Variables nécessaires

```
PERENUAL_API_KEY=   # optionnel — obtenir une clé sur perenual.com
TREFLE_API_KEY=     # optionnel — obtenir un token sur trefle.io
```

WCVP (via l'API publique GBIF) ne nécessite aucune clé.

Si une clé est absente, le fournisseur correspondant est explicitement
marqué `skipped_no_key` pour chaque plante — le benchmark continue
normalement pour WCVP et pour l'autre fournisseur horticole.

## 3. Comment lancer

Depuis la racine du repo :

```bash
npm run plant:benchmark
```

(équivalent à `node scripts/plant-benchmark/src/index.js`)

### Lancer les tests unitaires locaux (aucun réseau requis)

```bash
npm run plant:benchmark:test
```

(équivalent à `node --test scripts/plant-benchmark/test/*.test.js`)

Ces tests utilisent uniquement `node:test`/`node:assert` (aucune dépendance
ajoutée) et de petites fixtures locales — zéro appel réseau, zéro clé API
nécessaire. Ils vérifient la logique de mapping et de sélection de
candidats en isolation, indépendamment du blocage réseau de cet
environnement (voir "Limites connues de l'exécution" plus bas). Voir la
section "Corrections apportées (revue de fiabilité)" pour le détail de ce
que chaque fichier de test couvre.

## 4. Où apparaissent les résultats

```
scripts/plant-benchmark/output/
  normalized.json       — modèle intermédiaire complet (une entrée par plante)
  coverage.csv           — taux de remplissage par trait (BENCHMARK_TRAITS + extra_discovered_traits) et par fournisseur
  contradictions.csv     — divergences numériques significatives détectées
  taxonomy.csv            — vue synthétique des correspondances face à WCVP
  errors.json             — chaque échec réseau/HTTP, structuré, jamais fatal
  report.md               — rapport narratif complet (voir sa table des matières)
```

Les réponses brutes de chaque appel sont conservées dans
`scripts/plant-benchmark/raw/{wcvp,perenual,trefle}/` pour audit manuel.
Ni `raw/` ni `output/` ne sont commités (voir `.gitignore`).

## 5. Comment relancer proprement

Relancer `npm run plant:benchmark` écrase entièrement `output/` et ajoute/
écrase les fichiers `raw/` correspondant à chaque plante interrogée — aucune
étape manuelle de nettoyage n'est nécessaire entre deux exécutions normales.

## 6. Comment vider le cache/réponses brutes

```bash
rm -rf scripts/plant-benchmark/raw scripts/plant-benchmark/output
```

(Les deux dossiers sont recréés automatiquement à la prochaine exécution.)

## Panel de plantes

Défini dans `plants.json` — 20 entrées volontairement hétérogènes : espèces,
cultivars nommés (`Acer palmatum 'Bloodgood'`, `Taxus baccata 'Fastigiata'`,
`Hydrangea paniculata 'Bobo'`), un genre seul (`Hosta`), et deux noms
anciens/synonymes délibérément inclus pour tester la réconciliation
taxonomique (`Rosmarinus officinalis`, `Pennisetum alopecuroides`) — le nom
actuellement accepté n'est jamais présupposé dans ce fichier, c'est
précisément ce que WCVP doit déterminer.

## Sources et méthode

- **WCVP** — interrogé via l'API publique GBIF (`api.gbif.org/v1/species/*`),
  filtrée sur le `datasetKey` du dataset "World Checklist of Vascular
  Plants" publié par le Royal Botanic Gardens, Kew
  (`f382f0ce-323a-4091-bb9f-add557f3a9a2`). Données structurées uniquement,
  jamais de scraping HTML de POWO. Sert uniquement à l'identité
  taxonomique — jamais aux traits horticoles.
- **Perenual** — `perenual.com/api/v2` (`species-list` puis
  `species/details/{id}`), traits horticoles + identification de cultivar.
- **Trefle** — `trefle.io/api/v1` (`plants/search` puis `species/{id}`),
  traits structurés + provenance par source quand l'API l'expose.

## Limites connues de l'exécution dans cet environnement

Cet outil a été implémenté dans un environnement dont la politique réseau
sortante **bloque explicitement** `api.gbif.org`, `perenual.com` et
`trefle.io` (confirmé par un test direct : `403` au niveau du tunnel
CONNECT du proxy, avant même toute question de clé API). Conséquences :

- Le mapping des champs de réponse (Perenual, Trefle, et dans une moindre
  mesure la forme exacte des objets GBIF) a été écrit à partir de la
  documentation publique et de résultats de recherche, **pas** d'une
  inspection d'une réponse réelle — chaque fichier provider contient un
  avertissement explicite à ce sujet en tête de fichier.
- Une exécution réelle dans CET environnement produira systématiquement des
  erreurs réseau structurées (`output/errors.json`) pour les trois
  fournisseurs, quelle que soit la présence de clés API — ce n'est pas un
  bug du benchmark, c'est la politique d'egress de la session.
- **Avant de tirer la moindre conclusion sur la couverture réelle des
  données**, ce script doit être exécuté dans un environnement disposant
  d'un accès réseau sortant normal (poste de développement local, CI avec
  egress ouvert, etc.), avec de vraies clés `PERENUAL_API_KEY` /
  `TREFLE_API_KEY`.
- Le code lui-même n'a pas besoin d'être modifié pour cela : il a été conçu,
  et testé dans cet environnement, pour dégrader proprement (chaque échec
  réseau devient une entrée structurée dans `errors.json`, jamais un crash)
  plutôt que pour supposer un accès réseau garanti.

## Fiabilité

- Timeout par requête : 15s.
- Retries bornés : 1 tentative initiale + 2 retries maximum, jamais plus.
- 429 / 5xx : backoff (respecte `Retry-After` si présent, plafonné à 10s),
  jamais une boucle non bornée.
- Rate limiting : throttle simple, un délai minimal entre deux requêtes
  vers un même fournisseur.
- Une plante non trouvée, ou un fournisseur indisponible, n'interrompt
  jamais le reste du benchmark — chaque échec est capturé et journalisé
  individuellement dans `output/errors.json`.
- Aucune clé API n'est jamais écrite dans un log, un fichier `raw/`, ou un
  fichier `output/` — les URLs journalisées ont leurs paramètres
  `key`/`token` remplacés par `***` avant tout affichage ou écriture.

## Corrections apportées (revue de fiabilité)

Une revue ciblée a identifié plusieurs risques de fabrication de données
(faux `null`, faux matchs, équivalences sémantiques incorrectes, provenance
trop précise) dans l'implémentation initiale. Corrections apportées, fichier
par fichier :

### Perenual (`src/providers/perenual.js`)

- **Dimensions** : lues via `dimensions.min_value` / `dimensions.max_value`
  / `dimensions.unit` (forme documentée), plus jamais `.min`/`.max`. La
  conversion en cm passe par une liste blanche déterministe d'unités
  (cm, m/meter(s), ft/feet/foot, in/inch(es)) ; une unité hors liste donne
  `normalized_value: null` en gardant `raw_value`/`raw_unit` intacts —
  jamais une conversion devinée.
- **`evergreen`** : n'est plus jamais déduit de `cycle` (qui décrit le cycle
  de vie — annuel/vivace/bisannuel — pas la persistance du feuillage). Seul
  un champ explicite et sans ambiguïté est utilisé s'il existe réellement ;
  à défaut, `evergreen` reste absent plutôt que déduit.
- **`edible`** (corrigé) : `edible_fruit` et `edible_leaf` restent deux
  traits distincts et bruts. `edible` est désormais une dérivation
  documentée à **trois états**, jamais une simple règle "un `false`
  suffit" : `true` si au moins un composant est explicitement `true` ;
  `false` uniquement si TOUS les composants supportés (`edible_fruit`,
  `edible_leaf`) sont explicitement présents ET `false` ; `null` dans tous
  les autres cas (composant manquant/`null`/inconnu, sans qu'aucun ne soit
  `true`) — jamais une supposition. `edible` n'est ajouté au tout que si au
  moins un composant a réellement été présent dans la réponse ; si l'API ne
  dit rien du tout sur la comestibilité, rien n'est fabriqué.
- Champs documentés supplémentaires récupérés tels quels, sans
  réinterprétation : `type, sunlight, soil, hardiness.min/max, growth_rate,
  drought_tolerant, attracts, flowering_season, edible_fruit, edible_leaf,
  cultivar, variety, subspecies, hybrid`.
- **Sélection de candidat** : `candidates[0]` supprimé. Passe désormais par
  `selectCandidate` (voir plus bas) — une requête de cultivar dont seul le
  parent est trouvé produit `parent_only`, jamais un faux
  `exact_cultivar_match`.

### Trefle (`src/providers/trefle.js`)

- **`soil_moisture`** vient désormais uniquement de `growth.soil_humidity`.
  L'ancien mapping bugué (`atmospheric_humidity → soil_moisture`) est
  supprimé ; `atmospheric_humidity` reste un trait à part entière, jamais
  fusionné avec `soil_moisture`.
- **`minimum_precipitation`/`maximum_precipitation`** ne sont plus mappés
  vers `water_need` (deux notions différentes — précipitations annuelles vs
  besoin en arrosage). Ils deviennent `minimum_precipitation_mm_year` /
  `maximum_precipitation_mm_year` ; `water_need` reste `null`/absent pour
  Trefle.
- **Hauteur/étalement multi-source** : `growth.maximum_height` et
  `specifications.maximum_height` (deux blocs différents de la même
  réponse) sont conservés comme deux observations distinctes du même trait,
  chacune taguée par son `field_path` — jamais fusionnées ni l'une
  n'écrasant silencieusement l'autre.
- **Provenance** : Trefle documente `sources` au niveau de la fiche entière,
  pas par trait. La provenance est donc représentée au niveau de
  l'enregistrement (`{provider, record_sources, source_scope: "record"}`) ;
  aucune observation individuelle ne se voit attribuer une licence ou une
  attribution tirée de `sources[0]`.
- Champs structurés documentés supplémentaires mappés : `ph_minimum/maximum`,
  `minimum/maximum_temperature`, `growth_rate`, `drought_tolerance`,
  `bloom_months`, `soil_texture`, `light`.
- **Sélection de candidat** : même logique partagée que Perenual/WCVP, plus
  de `candidates[0]`.

### Sélection de candidats — logique partagée (`src/candidateSelection.js`, nouveau fichier)

- Un seul module, utilisé identiquement par WCVP, Perenual et Trefle : plus
  aucun fournisseur ne prend `candidates[0]` silencieusement.
- Vocabulaire de statut explicite et documenté :
  `exact_scientific_match`, `exact_cultivar_match`, `parent_taxon_match`,
  `parent_only`, `ambiguous`, `not_found`. (`synonym_match` et
  `taxonomy_conflict` sont produits par la comparaison croisée avec WCVP,
  voir `classifyMatch` dans `taxonomyMatch.js`.)
- Règles de priorité documentées dans le code : pour une requête d'espèce,
  correspondance scientifique exacte > parent/infraspécifique compatible >
  flou ; pour une requête de cultivar, cultivar exact > parent seul
  (`parent_only`) > flou.
- **Cas critique cultivar** : si un fournisseur ne renvoie que l'espèce
  parente pour une requête de cultivar, le résultat est explicitement
  `parent_only` — jamais présenté comme un match de cultivar réussi.
- Deux candidats à égalité de score (hors 100/exact) ne sont jamais
  départagés arbitrairement : le résultat devient `ambiguous`. Zéro
  candidat → `not_found`. Aucune IA, aucune librairie de fuzzy-matching :
  des règles de chaînes simples, déterministes et documentées.
- Piste d'audit complète conservée par requête : chaque candidat annoté de
  son `normalized_comparison_name`, son `score` et sa `reason` — jamais
  seulement le candidat retenu.

### WCVP (`src/providers/wcvp.js`)

- La recherche passe par `datasetKey=<WCVP>` sur l'API GBIF (accès
  structuré), avant tout repli approximatif.
- Le repli par recherche floue ne prend plus jamais `results[0]`
  silencieusement — même logique de sélection que les deux autres
  fournisseurs ; un résultat non fiable devient `ambiguous`.
- **Synonymes** : la fiche effectivement trouvée par la requête
  (`queried_usage`) n'est plus jamais présentée comme la fiche acceptée. Si
  elle est un synonyme, un second appel GBIF (`acceptedKey`) résout la
  vraie fiche acceptée (`accepted_usage`) ; les deux restent des objets
  distincts et disponibles séparément.
- **Cultivar** : jamais traité comme un taxon botanique indépendant. Le nom
  d'entrée est toujours scindé en `taxonomic_parent` / `cultivar_name`
  avant toute requête WCVP — WCVP n'est interrogé que sur le parent.
- **Normalisation des noms** : `raw_name` est toujours conservé tel quel ;
  une `normalized_comparison_name` distincte sert uniquement à la
  comparaison, jamais à remplacer le nom d'origine dans les résultats.

### Rapports et couverture (`src/index.js`, `src/coverage.js`, `src/report.js`, `src/taxonomyCsv.js`)

- Les états `missing_trait` / `skipped_no_key` / `not_found` / `ambiguous` /
  `parent_only` / `provider_error` ne sont jamais confondus entre eux dans
  les rapports.
- **Deux dénominateurs distincts, jamais confondus**, pour chaque trait :
  - *conditional coverage* : parmi les plantes où le fournisseur a un
    statut réellement exploitable (`exact_scientific_match`,
    `exact_cultivar_match`, `parent_taxon_match`, `parent_only`), quelle
    proportion porte ce trait.
  - *end-to-end coverage* : sur l'ensemble du panel (dénominateur fixe =
    taille totale du panel), quelle proportion porte ce trait — inclut
    donc, sans le masquer, le manque à gagner dû aux enregistrements non
    exploitables.
- **`BENCHMARK_TRAITS` (`src/coverage.js`, nouveau)** : liste canonique et
  fixe des traits que l'on veut évaluer pour le futur Plant Finder,
  indépendamment de ce qu'un fournisseur donné retourne réellement — chaque
  nom de la liste correspond à un trait déjà réellement implémenté par un
  mapper provider, jamais un champ inventé ou un mapping fabriqué pour
  combler un trou. Un `BENCHMARK_TRAIT` totalement absent des résultats
  d'une exécution apparaît quand même dans `coverage.csv`/`report.md`
  (`0/<total> = 0%` conditional et end-to-end) — jamais silencieusement
  omis.
- **`extra_discovered_traits`** : les traits réellement retournés par un
  fournisseur mais qui ne font pas partie de `BENCHMARK_TRAITS` (ex.
  `atmospheric_humidity`/précipitations chez Trefle, `soil` générique chez
  Perenual) apparaissent séparément — dans `report.md` sous leur propre
  section, et dans `coverage.csv` via la colonne `trait_scope`
  (`benchmark_trait` vs `extra_discovered_trait`) — sans jamais élargir ni
  modifier la liste canonique fixe.
- `discoverTraitNames` reste utilisé uniquement pour calculer
  `extra_discovered_traits` — plus jamais pour décider quels traits
  apparaissent dans la table de couverture canonique elle-même, ce qui
  évite d'inventer des renommages sémantiques (ex. ne pas forcer
  `attracts` en un `pollinator_value` non vérifié).

## Tests unitaires locaux

Fichiers dans `test/`, exécutables via `npm run plant:benchmark:test`,
zéro réseau, zéro clé API :

- `normalize.test.js` — conversion d'unités déterministe (`convertToCm`) :
  passthrough cm, m→cm, ft→cm, in→cm, unité inconnue → `null` (jamais une
  estimation), valeur non numérique → `null` (jamais `0`).
- `perenual.test.js` — lecture de `dimensions.min_value/max_value` (pas
  `.min`/`.max`) ; unité de dimension non supportée → `normalized_value`
  `null` avec `raw_value` conservé ; `evergreen` jamais déduit de `cycle` ;
  dérivation `edible` à **trois états** (`fruit=false`+`leaf=null` →
  `null` ; `fruit=null`+`leaf=false` → `null` ; `fruit=false`+`leaf=false`
  → `false` ; `fruit=true`+`leaf=false` → `true` ; `fruit=null`+`leaf=null`
  → `null`) ; sélection de candidat cultivar exact vs `parent_only`.
- `trefle.test.js` — `soil_moisture` vient de `growth.soil_humidity` et
  jamais de `atmospheric_humidity` (qui reste un trait distinct) ;
  précipitations jamais mappées vers `water_need` ; champs structurés
  documentés supplémentaires ; hauteur `growth.*` vs `specifications.*`
  conservées comme observations séparées ; provenance au niveau
  enregistrement uniquement, jamais par trait.
- `wcvp.test.js` — usage accepté direct ; résolution synonyme →
  `accepted_usage` distinct de `queried_usage` ; candidats multiples sans
  correspondance fiable → `ambiguous` ; zéro candidat → `not_found` ;
  cultivar toujours scindé en parent + cultivar, jamais traité comme un
  taxon WCVP indépendant.
- `coverage.test.js` — `eligibleCount`/`computeRecordCoverage`/
  `computeExactCultivarCoverage` (dénominateurs corrects, division par zéro
  sûre) ; `computeCoverage` renvoie systématiquement tous les
  `BENCHMARK_TRAITS`, y compris un trait jamais rempli par aucun
  fournisseur (`0/<total> = 0%`) ; un trait supplémentaire réellement
  découvert apparaît via `computeExtraDiscoveredTraitCoverage` sans jamais
  modifier `BENCHMARK_TRAITS` lui-même.

## Ce que ce benchmark ne fait PAS (hors scope, spec §19)

USDA PLANTS, TRY, World Flora Online, RHS, PlantNet, occurrences GBIF,
Open-Meteo, scoring Plant Finder, IA, frontend — aucun de ces éléments n'est
touché par cet outil.
