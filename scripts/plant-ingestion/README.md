# Plant Ingestion (outil isolé, PLAN → VALIDATE → APPLY → VERIFY)

Pipeline d'ingestion botanique en 3 couches, entièrement séparé du reste de
l'application. Aucune de ces couches ne modifie `pages/`, `components/`,
`styles/`, ni le code auth/jardin/rappels/profil.

- **Layer A** (`src/index.js`, `src/bundle.js`) — collecte dry-run à partir
  des APIs Perenual/Trefle/GBIF-WCVP. N'écrit qu'un fichier JSON local
  (`output/acer-mini-batch.json`). Ne touche jamais Supabase.
- **Layer B** (`src/planCli.js`, `src/plan/*.js`) — compile et valide ce
  bundle en un **transaction plan** (`output/acer-transaction-plan.json`).
  Pur, sans I/O réseau ni Supabase. `approval_required: true` sur chaque
  plan produit.
- **Layer C** (`src/applyCli.js`, `src/verifyCli.js`, `src/apply/*.js`) —
  **la seule couche qui écrit réellement dans Supabase**, documentée ici.

### Sélection automatique déterministe (`src/selections.js`)

Layer A ne propose une `trait_selection` automatique que pour un nombre
volontairement restreint de traits — un `trait_selection` promeut une
valeur vers une colonne réelle de `plant_catalog`
(`PROMOTABLE_CATALOG_COLUMNS`), donc chaque trait doit avoir une règle de
sélection déterministe et documentée avant d'y entrer :

- `height_min_cm`
- `height_max_cm`
- `plant_type`
- `growth_form`
- `spread_max_cm`
- `evergreen`
- `flowering_months`
- `sun` reste un cas à part (`proposeSun`) : il copie verbatim le
  `normalized_value` déjà crosswalké par `normalization.js`, jamais un
  second calcul indépendant.

**Provider-neutre par construction** : aucune priorité Perenual/Trefle
n'est codée nulle part. Une sélection n'est proposée que si **toutes** les
observations non-`uncertain` de ce trait, tous fournisseurs confondus,
s'accordent sur la même valeur normalisée — une vraie divergence entre
fournisseurs bloque la proposition entière (un avertissement explicite est
émis), jamais un arbitrage "Perenual gagne". C'est ce qui permet à Trefle
seul de faire aboutir une sélection quand Perenual est indisponible
(`plan_restricted`/`unresolved_under_plan`/`not_found`), sans code
spécifique à un fournisseur.

Tout autre trait peut avoir des `trait_observations` (donc rester
consultable/traçable), mais n'aura jamais de `trait_selection` tant
qu'aucune règle déterministe n'est ajoutée ici — notamment
`water_need`, `edible`/`edible_fruit`/`edible_leaf`,
`hardiness_min_rank`/`hardiness_max_rank`, `container_suitable` :
aucun de ces mappings n'existe aujourd'hui et aucun ne doit être deviné
depuis des connaissances horticoles générales.

## 1. Où créer le fichier local de variables d'environnement

```bash
cp scripts/plant-ingestion/.env.ingestion.example scripts/plant-ingestion/.env.ingestion
```

Puis éditer `scripts/plant-ingestion/.env.ingestion` (jamais commité — déjà
couvert par la règle `.env*` du `.gitignore` racine).

## 2. Variables nécessaires (Layer C uniquement)

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Ces deux variables sont **serveur/local uniquement**. Elles ne portent
jamais le préfixe `NEXT_PUBLIC_`, ne sont jamais loggées (`src/apply/
supabaseConfig.js` n'expose que des booléens `hasUrl`/`hasServiceRoleKey`
pour le reporting), et ne sont importées par aucun fichier accessible
depuis le bundle navigateur Next.js (`pages/*`, `components/*`, `lib/*`
côté client).

Le `service_role` est nécessaire car trois tables (`plant_source_records`,
`plant_trait_observations`, `plant_trait_selections`) ont RLS activé sans
aucune policy anon/authenticated — seule une clé service_role peut les lire
ou les écrire.

Si l'une des deux variables est absente, `applyCli.js` et `verifyCli.js`
s'arrêtent proprement avec un message explicite et un code de sortie non
nul — aucun client Supabase n'est créé, rien n'est lu ni écrit.

## 3. Étapes complètes

```bash
# 1. Layer A — collecte dry-run (jamais Supabase)
npm run plant:ingestion:dry-run

# 2. Layer B — compilation + validation du plan (pur, jamais Supabase)
npm run plant:ingestion:plan

# 3. Layer C — dry-run d'application (par défaut, AUCUNE écriture)
npm run plant:ingestion:apply

# 4. Layer C — application réelle (écrit dans Supabase)
npm run plant:ingestion:apply -- --apply

# 5. Layer C — vérification post-apply (lecture seule)
npm run plant:ingestion:verify
```

**`npm run plant:ingestion:apply` seul (sans `--apply`) n'écrit jamais rien
dans Supabase.** C'est un dry-run complet : chaque étape effectue les
mêmes lectures qu'un apply réel (pour un rapport fiable), mais aucun
`insert`/`update` n'est jamais exécuté. Le flag `--apply` est la seule
façon de déclencher une écriture réelle.

### Traiter un autre lot que Acer (`--plants`/`--out`, `--bundle`/`--plan`)

Layer A et Layer B acceptent n'importe quelle taille de lot — un ou
plusieurs `input_name`/`type`, un ou plusieurs cultivars par espèce.
Sans arguments, les deux CLIs se comportent exactement comme avant
(fichiers `plants.json`/`output/acer-mini-batch.json`/
`output/acer-transaction-plan.json` inchangés) :

```bash
# Lot pilote (6 plantes, voir pilot-batch-1.plants.json) :
node scripts/plant-ingestion/src/index.js \
  --plants scripts/plant-ingestion/pilot-batch-1.plants.json \
  --out scripts/plant-ingestion/output/pilot-batch-1-bundle.json

node scripts/plant-ingestion/src/planCli.js \
  --bundle scripts/plant-ingestion/output/pilot-batch-1-bundle.json \
  --plan scripts/plant-ingestion/output/pilot-batch-1-transaction-plan.json
```

Chaque famille de taxon (une espèce et tous ses cultivars présents dans
le même fichier `--plants`) ne déclenche qu'**un seul** appel WCVP,
partagé — jamais un appel par plante (`src/batchGrouping.js`, testé
unitairement). Un cultivar dont l'espèce parente n'est pas présente dans
le même fichier fait échouer le chargement explicitement, avant tout
appel réseau — jamais une hypothèse silencieuse sur son
`parent_catalog_ref`.

## 4. Stratégie d'écriture (upsert sur clés naturelles)

Chaque table est écrite via une clé naturelle réelle (contrainte unique en
base), jamais via un UUID fabriqué par le plan :

| Table | Clé naturelle | Comportement |
|---|---|---|
| `plant_taxa` | `wcvp_taxon_id` | insert ou update complet |
| `plant_taxon_names` | `(taxon_id, normalized_name)` | insert ou update complet |
| `plant_catalog` | `slug` | insert (avec `publication_status`/`review_status`/`published_at` du plan) ou update — **ces 3 champs ne sont jamais réécrits après la création initiale** |
| `plant_source_records` | ligne courante `(plant_catalog_id, provider)` où `superseded_at is null` | insert si absente, "unchanged" si identique, sinon la ligne courante est clôturée (`superseded_at`) et une nouvelle ligne courante est insérée |
| `plant_trait_observations` | pas de contrainte unique réelle — dédoublonnage applicatif sur `(plant_catalog_id, trait, provider, field_path, plant_source_record_id)` + égalité profonde de `raw_value` | insert uniquement si aucune ligne équivalente n'existe déjà — jamais d'update (table append-only par conception) |
| `plant_trait_selections` | `(plant_catalog_id, trait)` | insert si absente ; si elle existe déjà, comportement différent selon le `decision_method` **réellement stocké en DB** — voir §4bis |

### Provenance vs contenu (`plant_source_records.retrieved_at`)

`retrieved_at` (et son équivalent au niveau observation,
`plant_trait_observations.source_retrieved_at`) enregistre **une
information de provenance/audit** — le moment où ce fournisseur a été
interrogé — pas une information sur le contenu de la réponse. À chaque
régénération de Layer A/B, `retrieved_at` est re-timbré à l'heure de
collecte, même quand le fournisseur renvoie une donnée strictement
identique (même `provider_record_id`, même `metadata`, même
`taxonomy_match_type`, même `source_url`).

**`retrieved_at` seul ne déclenche donc jamais une supersession.** Il est
exclu de `COMPARE_FIELDS` dans `upsertSourceRecords.js` — seule une
véritable différence de contenu (`provider_record_id`, `provider_name`,
`provider_status`, `selection_reason`, `taxonomy_match_type`,
`candidate_count`, `source_url`, `metadata`) déclenche un `update`
(supersession). Une nouvelle ligne réellement créée ou supersédée
conserve bien entendu son propre `retrieved_at` réel dans la ligne
insérée — seul le **critère de décision** "même donnée vs donnée
différente" ignore ce champ.

`metadata` reste dans `COMPARE_FIELDS`, mais n'est plus comparé avec un
`JSON.stringify` naïf — voir `### Comparaison JSON stable` ci-dessous.

### Comparaison JSON stable (`src/apply/stableEqual.js`)

Trouvé sur des données réelles de production : le même objet `metadata`
Perenual, et la même valeur `raw_value` du trait `edible`
(`{edible_leaf, edible_fruit}`), stockés en base avec un **ordre de clés
différent** de celui du plan — bien que le contenu soit strictement
identique. Une comparaison `JSON.stringify(a) !== JSON.stringify(b)` est
sensible à cet ordre et déclenchait donc un faux `updated`/`created`.

`stableEqual(a, b)` (`src/apply/stableEqual.js`) corrige ceci avec une
égalité profonde qui :
- **ignore l'ordre des clés** d'un objet (`{a:1,b:2}` === `{b:2,a:1}`) —
  un objet jsonb est une map, pas une séquence ;
- **conserve l'ordre des éléments** d'un tableau
  (`["sun","shade"]` !== `["shade","sun"]`) — un tableau comme `sun` est
  une donnée ordonnée signifiante, pas un ensemble.

Utilisé pour : `plant_source_records.metadata`
(`upsertSourceRecords.js`), `plant_trait_observations.raw_value`
(`upsertObservations.js` et `verifyPlan.js`). Volontairement **pas**
utilisé pour les champs qui n'en ont pas besoin : les `DEDUP_FIELDS`
d'observation (`plant_catalog_id`, `trait`, `provider`, `field_path`,
`plant_source_record_id`) sont de simples scalaires texte/uuid, sans
risque d'ordre — comparés tels quels pour ne pas complexifier
inutilement ; de même pour tous les champs de `plant_taxa`,
`plant_taxon_names`, `plant_trait_selections` (aucun n'est un objet) et
les champs `sun`/`flowering_months` de `plant_catalog` (des tableaux,
déjà correctement comparés dans l'ordre par `JSON.stringify`).

### Invariant de comptabilité (`upsertObservations.js`)

Chaque ligne d'entrée doit finir dans **exactement une** catégorie :
`created`, `unchanged`, ou `failed` (jamais `updated` pour cette table
append-only). `upsertObservations` vérifie explicitement en fin
d'exécution que `created + updated + unchanged + failed` égale bien le
nombre de lignes reçues — si ce n'est pas le cas, un message
`accounting mismatch: input=N accounted=M` est ajouté à `errors`, jamais
masqué en forçant les totaux à correspondre. Une ligne dont le lookup DB
échoue est comptée `failed`, jamais fabriquée comme `created` (avant
correction, un échec de lookup faisait silencieusement retomber le code
sur un tableau vide, ce qui faisait passer chaque ligne de ce lot pour
une "création" légitime — jamais vérifiée en réalité contre la DB).

### Résolution des IDs en dry-run ("would update")

Un dry-run n'écrit jamais rien — donc quand `upsertSourceRecords`
détermine qu'une ligne existante *serait* mise à jour (supersédée), cette
ligne existante **reste réellement la ligne courante en base** pendant
toute la durée du dry-run. `idByRef` doit donc continuer à pointer vers
`existing.id` (l'id réel de la ligne actuelle), jamais vers `null`.

C'est un point critique : les tables filles (`plant_trait_observations`,
`plant_trait_selections`) résolvent leurs propres identifiants parents via
ces mêmes `idByRef`. Si un `idByRef` de source record est mis à `null` à
tort pendant un dry-run "would update", chaque observation qui en dépend
tombe dans la branche "le parent n'existe pas encore" et est comptée
`created` **sans jamais effectuer sa propre comparaison DB** — et chaque
sélection qui dépend d'une de ces observations subit la même cascade. Un
seul faux `updated` sur `plant_source_records` peut ainsi faire
apparaître des dizaines de fausses créations en aval, alors que les
données existent déjà et sont strictement identiques.

Ce comportement a été trouvé lors du premier dry-run réel contre la
production (6 `source_records` réellement matchés mais rapportés
`updated`, provoquant en cascade 33 `trait_observations` et 7
`trait_selections` faussement rapportées `created` alors qu'elles
existaient déjà) — corrigé dans `upsertSourceRecords.js` : la branche
dry-run de "genuine change" pointe désormais `idByRef` vers `existing.id`.
Le comportement du vrai apply (non-dry-run) était déjà correct et n'a pas
changé : après une supersession réelle, `idByRef` pointe vers le
`id` de la nouvelle ligne insérée. Couvert par
`test/apply/upsertSourceRecords.test.js` (test "CRITICAL") et
`test/apply/applyPlan.test.js` (test "REGRESSION").

### Champs curateur protégés (`plant_catalog`)

`plant_catalog.publication_status` / `review_status` / `published_at`
sont **propriété du curateur**. Layer B garantit que tout plan porte
toujours `draft`/`unreviewed` (invariants O/P — un plan ne peut jamais dire
autre chose). Ces 3 champs ne sont écrits qu'à la création initiale d'une
ligne (avec les valeurs `draft`/`unreviewed` du plan) et **ne sont plus
jamais réécrits** lors d'une mise à jour ultérieure. Si un curateur a
publié une fiche à la main en production, ré-appliquer le même plan ne la
repasse jamais en brouillon — même si un champ d'ingestion (hauteur, sun,
etc.) a réellement changé et déclenche un `update` sur les autres colonnes.
**Ce comportement est intentionnel et ne doit jamais être modifié** sans
une décision explicite du curateur produit.

## 4bis. Sélections automatiques vs manuelles (`plant_trait_selections`)

`decision_method` (contrainte CHECK réelle) ne peut valoir que
`provider_observation`, `editorial`, ou `manual_resolution`. Layer B ne
produit jamais `manual_resolution` dans un plan (voir
`src/plan/compileSelections.js`) — cette valeur n'apparaît en DB que si un
curateur a modifié la ligne à la main, après ingestion, via l'outil de
curation éditoriale (§4ter ci-dessous).

- **Aucune sélection existante** → `INSERT` avec les valeurs du plan.
- **Sélection existante avec `decision_method = "manual_resolution"` en
  DB** → **jamais modifiée**, quoi que dise le plan. Rapportée
  `unchanged`. `selected_observation_id`, `decision_method`, `decided_by`
  et `note` sont préservés exactement. La protection se base sur la
  valeur **réellement stockée en base**, jamais sur celle du plan (le plan
  ne peut de toute façon jamais recommander `manual_resolution`).
- **Sélection existante avec un `decision_method` automatique
  (`provider_observation` ou `editorial`) en DB** → comparée au plan sur
  `selected_observation_id`, `decision_method`, `decided_by`, `note` :
  - identique → `unchanged`, aucune écriture.
  - différente (le plan recommande une autre observation, ou une autre
    méthode automatique) → `UPDATE` autorisé.

Ce comportement est couvert par `test/apply/upsertSelections.test.js`
(9 scénarios numérotés dont le test 6, anti-clobber, qui vérifie qu'une
`manual_resolution` n'est jamais écrasée même quand le plan recommande
autre chose).

## 4ter. Curation éditoriale contrôlée (`src/editorial/`, `src/editorialCli.js`)

Un outil séparé pour compléter, à la main et de façon traçable, les traits
qu'aucun provider ne fournit (ou fournit en conflit non résolu) — jamais un
remplacement de Layer A/B/C, un **overlay**. Quatre notions distinctes, à ne
jamais confondre :

```
provider ingestion  ≠  editorial observation  ≠  manual selection  ≠  publication
(Layer A/B/C,           (un fait constaté,        (une décision parmi        (plant_catalog.
 wcvp/perenual/trefle)   avec sa provenance —       les observations           publication_status,
                         jamais une décision)       existantes — jamais        toujours séparée,
                                                     une nouvelle donnée)       jamais automatique)
```

**`manual_resolution` est la SEULE décision humaine protégée.** Une
sélection `decision_method="editorial"` resterait re-synchronisable
automatiquement par un futur re-run (voir §4bis) — seule
`manual_resolution` est jamais ré-écrasée par Layer C, quelle que soit la
source de l'observation qu'elle pointe (provider ou éditoriale).

### Format d'entrée

```json
{
  "catalog_ref": "lavandula_angustifolia_species",
  "trait": "sun",
  "raw_value": ["full_sun"],
  "normalized_value": ["full_sun"],
  "source": { "title": "...", "publisher": "...", "url": "...", "license": "..." },
  "review": { "note": "...", "decided_by": null }
}
```

`--input` accepte un objet unique ou un tableau de plusieurs.

### Modules purs (`src/editorial/`)

- `editorialVocab.js` — vocabulaire dupliqué (jamais importé) de
  `lib/plantFinderFormat.js` (`SUN_VALUES`, `PLANT_TYPE_VALUES`) + la forme
  attendue de chaque trait promouvable (`TRAIT_KINDS`).
- `validateEditorialInput.js` — validation pure, aucun accès DB : `trait`
  doit être un des 13 `PROMOTABLE_CATALOG_COLUMNS` (`soil` explicitement
  rejeté — cette colonne n'existe pas dans `plant_catalog`), valeur
  conforme à `TRAIT_KINDS`, `source.url`/`title`/`publisher`/`license`
  obligatoires, `license: "unknown"` explicitement interdit.
- `buildEditorialObservation.js` — transforme une entrée validée en objet
  `plant_trait_observation`-like avec `provider="editorial"`,
  `source_scope="editorial"`, `plant_source_record_id=null`,
  `source_retrieved_at=null`, `review_status="accepted"` — tous ces champs
  sont **codés en dur**, jamais lus depuis l'entrée, pour qu'une entrée de
  curation ne puisse jamais produire une ligne non conforme à la contrainte
  réelle `plant_trait_observations_editorial_coherence_check`.
- `buildManualSelection.js` — `decision_method="manual_resolution"` codé en
  dur, jamais `"editorial"`.
- `buildEditorialPlan.js` — combine plusieurs entrées en un petit plan
  `{ mode: "editorial_plan", editorial_observations, manual_selections }` —
  **ne crée jamais** de `taxa`/`taxon_names`/`source_records`/
  `catalog_entries` ; référence uniquement des `catalog_ref` déjà
  existants. S'auto-valide via `guardEditorialPlan()` avant de retourner
  (même principe que `filterPlan.js` avec `guardPlan()`).
- `checkEditorialAgainstDb.js` — vérifications **lecture seule** contre
  Supabase (aucun write), utilisées par le CLI en mode preview sans
  `--apply`/`--verify` : le `catalog_ref` existe-t-il réellement (via
  `--catalog-map`, voir plus bas), une observation éditoriale identique
  existe-t-elle déjà (no-op) ou en conflit (valeur différente), une
  sélection `manual_resolution` existe-t-elle déjà (conflit protégé,
  jamais résolu automatiquement).
- `promoteCatalogTrait.js` — le SEUL endroit où une curation éditoriale
  écrit dans `plant_catalog`. Émet un `UPDATE` portant sur **une seule
  colonne** (`.update({ [trait]: value })`) — jamais une réutilisation de
  `apply/upsertCatalogEntries.js`, qui fait un `UPDATE` pleine ligne sur
  les 17 `CATALOG_INGESTION_FIELDS` à partir d'un `catalog_entries` complet
  que l'overlay éditorial n'a jamais (et ne doit jamais avoir). Réutiliser
  ce helper existant tel quel aurait silencieusement écrasé toutes les
  autres colonnes trait avec des valeurs absentes/nulles — c'est
  structurellement impossible ici, pas seulement évité par convention.
- `applyEditorialPlan.js` — l'orchestrateur `--apply`/dry-run. Traite
  chaque paire `(observation, selection)` **indépendamment** (pas de
  cascade table par table comme `apply/applyPlan.js` — une entrée
  éditoriale ne dépend d'aucune autre) : `catalog_ref -> plant_catalog.id`
  → `upsertObservations` (réutilisé tel quel) → vérification d'un éventuel
  conflit `manual_resolution` existant (lecture seule, comparaison par
  **valeur**, pas seulement par id d'observation) → `upsertSelections`
  (réutilisé tel quel) → `promoteCatalogTrait`. Une observation en échec
  bloque la sélection ET la promotion ; une sélection en échec ou en
  conflit bloque seulement la promotion — jamais masqué, toujours reporté
  explicitement par entrée.
- `verifyEditorialPlan.js` — vérification **lecture seule**, indépendante
  de la comptabilité de `applyEditorialPlan()` (même principe que
  `apply/verifyPlan.js` vis-à-vis de `applyPlan()`) : observation présente
  avec la bonne `normalized_value`, `review_status="accepted"`, sélection
  `manual_resolution` qui pointe bien dessus, `plant_catalog[trait]` qui
  correspond. `publication_status` est rapporté informationnellement, ou
  comparé réellement si l'appelant fournit un instantané "avant" via
  `expectedPublicationStatusByCatalogRef`.

### CLI (`src/editorialCli.js`)

```
node scripts/plant-ingestion/src/editorialCli.js \
  --input <editorial.json> \
  [--catalog-map <transaction-plan.json>] \
  [--apply] [--verify]
```

Sans `--apply` ni `--verify` : **DRY-RUN** — toutes les lectures qu'un
`--apply` ferait sont réellement exécutées (aperçu fidèle : créations,
mises à jour, inchangés, conflits, échecs — table par table :
`editorial_observations`, `manual_selections`, `catalog_promotions`, puis
un `TOTAL`), mais **aucun write**. `--catalog-map` est optionnel pour ce
mode : sans lui, le CLI valide et prévisualise le plan local sans jamais
contacter Supabase.

`--apply` et `--verify` sont mutuellement exclusifs et exigent tous deux
`--catalog-map` (nécessaire pour résoudre `catalog_ref -> plant_catalog.id`).
`--apply` affiche `"Mode: APPLY — editorial observations + protected manual
selections + catalog promotion"` avant toute écriture. **Aucun `--apply`
réel n'a été exécuté pendant ce chantier** — le chemin est implémenté et
testé exclusivement via le faux client Supabase en mémoire
(`test/apply/fakeSupabaseClient.js`), jamais invoqué contre un vrai projet.

### Garanties absolues (par construction, pas par convention)

- Ne modifie/supprime jamais une observation provider (`test 24`).
- Ne transforme jamais une observation provider en éditoriale.
- Ne crée jamais de `plant_source_records` pour une observation éditoriale
  (`test 3`).
- Ne modifie jamais `publication_status` ni `review_status` de
  `plant_catalog` — `promoteCatalogTrait.js` n'écrit **jamais** qu'une
  seule colonne trait, structurellement (`test 23`).
- Ne remplace jamais automatiquement une `manual_resolution` existante
  pointant vers une valeur différente — conflit explicite, aucune
  écriture de sélection, aucune promotion catalog (`test 13`, `test 14`).
- N'écrase jamais silencieusement une observation provider existante :
  `upsertObservations.js` (réutilisé tel quel) est append-only par
  construction, aucune ligne n'est jamais mise à jour, seulement créée ou
  reconnue identique.
- Ne masque jamais un échec partiel : observation échouée → sélection et
  promotion jamais tentées ; sélection échouée → promotion jamais tentée ;
  chaque étape échouée est reportée explicitement, jamais absorbée dans un
  compte "réussi" (`test 20`, `test 21`, `test 22`).

### Séquence complète pour une nouvelle fiche HOLD (future, pas exécutée ici)

```
1. provider sub-plan draft   (Layer A/B, --plants/--out puis --plan —
                               produit un transaction plan "draft", jamais
                               publié)
2. editorial overlay          (curation manuelle des traits manquants —
                               editorialCli.js sans --apply, puis --apply
                               une fois validé — jamais avant que le sub-plan
                               provider ci-dessus existe déjà, l'overlay
                               référence un catalog_ref déjà créé)
3. editorial verify            (editorialCli.js --verify — confirme
                               observation + sélection + promotion catalog,
                               lecture seule)
4. READY check                 (relire plant_catalog contre les critères
                               CRITICAL du Finder réel — plant_type, sun,
                               height_min/max_cm, spread_max_cm — voir
                               l'audit architecture éditoriale de ce
                               chantier pour le détail)
5. publication séparée          (acte humain distinct, hors périmètre de
                               cet outil — jamais automatique, jamais
                               déclenché par editorialCli.js)
```

**Important** : une entrée HOLD n'est jamais appliquée seule, en laissant
une fiche provider incomplète en attente d'une curation future. La
recherche/validation du contenu éditorial (sourcing, `source.url`/
`title`/`publisher`/`license`) doit être **prête avant** de créer et
d'appliquer le sub-plan provider — on ne crée le draft (étape 1) qu'une
fois l'overlay éditorial (étape 2) prêt à le compléter dans la foulée,
jamais un draft appliqué isolément en espérant une curation ultérieure.
Contrainte technique dans l'autre sens : l'overlay ne peut résoudre son
`catalog_ref` qu'une fois la ligne `plant_catalog` du draft réellement
écrite (il ne crée jamais de `catalog_entries` lui-même) — les étapes 1 et
2 se suivent donc immédiatement, jamais séparées par un intervalle où la
fiche reste incomplète et visible en base.

## 5. Idempotence

Ré-appliquer exactement le même plan une seconde fois doit toujours
produire `created=0` sur toutes les tables et un `unchanged` égal au
nombre de lignes du plan (sauf `plant_source_records`, où un changement de
données réel produit un `updated` = supersession, jamais un doublon ; et
sauf `plant_trait_selections`, où un changement réel sur une sélection
**automatique** produit un `updated` sur la même ligne — jamais un
`manual_resolution`, qui reste `unchanged` par construction). Ceci est
vérifié par les tests unitaires (`test/apply/applyPlan.test.js`, scénario
"idempotence" ; `test/apply/upsertSelections.test.js`, test 9).

## 6. Limite connue : pas de transaction multi-table réelle — politique de dépendance

`supabase-js` n'offre pas de transaction atomique multi-table côté REST —
chaque appel `insert`/`update` est indépendant. Layer C ne simule jamais
une fausse atomicité. La mitigation :

1. **Ordre d'écriture sûr** : `taxa → taxon_names → catalog_entries →
   source_records → trait_observations → trait_selections` — une ligne
   n'est jamais écrite avant que tout ce qu'elle référence par FK ne le
   soit déjà.
2. **Upserts sur clés naturelles** : relancer `applyPlan` après un échec
   partiel ne duplique jamais rien — les lignes déjà écrites sont
   retrouvées et rapportées "unchanged", pas réinsérées.
3. **Propagation d'erreur basée sur les FK réelles (`src/apply/
   applyPlan.js`)** : une étape dont la table dépend (par FK réelle) d'une
   étape parent en erreur est **sautée** (`status: "skipped"`), plutôt que
   lancée contre des identifiants qu'elle ne peut pas garantir corrects.
   Une étape dont la table ne dépend PAS de l'étape en erreur continue de
   s'exécuter normalement. Graphe de dépendance réel (d'après la
   migration `supabase/migrations/20260823124800_create_plant_finder_catalog_v1.sql`) :

   ```
   plant_taxa                (racine)
   plant_taxon_names         -> plant_taxa uniquement
   plant_catalog             -> plant_taxa uniquement (PAS plant_taxon_names)
   plant_source_records      -> plant_catalog uniquement
   plant_trait_observations  -> plant_catalog, plant_source_records (nullable)
   plant_trait_selections    -> plant_catalog, plant_trait_observations
   ```

   Conséquences concrètes :
   - une erreur `plant_taxa` **arrête tout le pipeline** (tout en dépend,
     directement ou transitivement) ;
   - une erreur `plant_taxon_names` **ne bloque rien** (aucune table ne la
     référence par FK) ;
   - une erreur `plant_catalog` bloque `source_records`,
     `trait_observations`, `trait_selections` ;
   - une erreur `plant_source_records` bloque `trait_observations` et
     `trait_selections` ;
   - une erreur `plant_trait_observations` bloque `trait_selections`
     uniquement.

   Cette granularité est **au niveau table, pas ligne** : une seule ligne
   en erreur dans une étape fait sauter toute la table dépendante en aval,
   même pour des lignes indépendantes qui auraient réussi. C'est une marge
   de sécurité volontairement plus large que strictement nécessaire, faute
   de transaction multi-table pour revenir en arrière proprement.

   Ce même comportement s'applique **identiquement en dry-run** — un
   dry-run qui rencontre une erreur de lecture sur une étape parent ne
   prétend jamais que les étapes filles pourraient être appliquées sans
   problème : elles sont sautées, pas simulées.

4. **Étapes sautées, jamais silencieuses** : chaque étape sautée porte
   `status: "skipped"` et `reason: "dependency_error: <table>"` dans le
   rapport (`report.steps.<table>`), et ne contribue jamais aux compteurs
   `created`/`updated`/`unchanged` — seulement à `totals.skipped`. Chaque
   erreur individuelle d'une étape qui a réellement tourné reste collectée
   dans `report.steps.<table>.errors`, rien n'échoue silencieusement.

## 7. Vérification post-apply

`npm run plant:ingestion:verify` relit indépendamment chaque ligne décrite
par le plan et vérifie : existence, unicité (exactement 1 ligne), et
cohérence de clé étrangère (ex: une fiche catalogue pointe vers le bon
taxon). C'est une vérification en lecture seule, indépendante du rapport
que `applyCli.js` produit lui-même — elle sert de garde-fou contre un bug
de comptabilité dans la couche d'application.

## 8. Procédure de reprise idempotente après échec

Si `npm run plant:ingestion:apply -- --apply` échoue en cours de route
(réseau, contrainte DB, etc.) :

1. Consulter le rapport imprimé — chaque table indique soit `created`/
   `updated`/`unchanged`/`errors` (étape exécutée), soit `SKIPPED
   (reason=dependency_error: <table>)` (étape sautée à cause d'une étape
   parent en erreur — voir §6). Chaque erreur nomme la ligne concernée.
2. Ne rien modifier à la main dans Supabase.
3. Relancer exactement la même commande une fois la cause de l'échec
   corrigée. Grâce aux upserts sur clés naturelles, les lignes déjà
   écrites ne sont pas dupliquées — elles sont retrouvées et rapportées
   `unchanged`. Les tables précédemment sautées sont retentées normalement
   dès que leur étape parent réussit.
4. Lancer `npm run plant:ingestion:verify` pour confirmer l'état final.

## 9. Tests

`npm run plant:ingestion:test` exécute tous les tests Layer A + B + C, plus
la curation éditoriale (`test/editorial.test.js` — validation/construction
pures ; `test/editorialApply.test.js` — apply/promotion/verify, 25
scénarios). Les tests Layer C (`test/apply/*.test.js`) et éditoriaux qui
touchent Supabase n'ont **aucune dépendance à un vrai Supabase** — ils
utilisent un faux client en mémoire (`test/apply/fakeSupabaseClient.js`)
qui reproduit le sous-ensemble de l'API `supabase-js` réellement utilisé
(`from().select()/insert()/update()`, `.eq()`/`.is()`, `.single()`/
`.maybeSingle()`).

Un test d'intégration réel contre un vrai projet Supabase n'est exécuté
que si des identifiants sont disponibles dans l'environnement — jamais
fabriqué ni simulé en leur absence.
