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

## 4. Où apparaissent les résultats

```
scripts/plant-benchmark/output/
  normalized.json       — modèle intermédiaire complet (une entrée par plante)
  coverage.csv           — taux de remplissage par trait et par fournisseur
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

## Ce que ce benchmark ne fait PAS (hors scope, spec §19)

USDA PLANTS, TRY, World Flora Online, RHS, PlantNet, occurrences GBIF,
Open-Meteo, scoring Plant Finder, IA, frontend — aucun de ces éléments n'est
touché par cet outil.
