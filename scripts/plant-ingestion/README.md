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
curateur a modifié la ligne à la main, après ingestion, via un outil de
curation (hors périmètre de Layer C).

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

`npm run plant:ingestion:test` exécute tous les tests Layer A + B + C.
Les tests Layer C (`test/apply/*.test.js`) n'ont **aucune dépendance à un
vrai Supabase** — ils utilisent un faux client en mémoire
(`test/apply/fakeSupabaseClient.js`) qui reproduit le sous-ensemble de
l'API `supabase-js` réellement utilisé (`from().select()/insert()/update()`,
`.eq()`/`.is()`, `.single()`/`.maybeSingle()`).

Un test d'intégration réel contre un vrai projet Supabase n'est exécuté
que si des identifiants sont disponibles dans l'environnement — jamais
fabriqué ni simulé en leur absence.
