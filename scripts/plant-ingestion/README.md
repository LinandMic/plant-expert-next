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
| `plant_trait_selections` | `(plant_catalog_id, trait)` | insert si absente — **jamais modifiée une fois créée**, même si le plan recommande une observation différente |

### Pourquoi 2 champs ne sont jamais mis à jour

- `plant_catalog.publication_status` / `review_status` / `published_at`
  sont **propriété du curateur**. Layer B garantit que tout plan porte
  toujours `draft`/`unreviewed` (invariants O/P — un plan ne peut jamais
  dire autre chose). Si un curateur a publié une fiche à la main, ré-
  appliquer le même plan ne doit jamais la repasser en brouillon.
- `plant_trait_selections` peut porter `decision_method = "manual_resolution"`
  — un curateur peut avoir choisi une observation différente de la
  recommandation automatique du plan. Une fois qu'une sélection existe,
  Layer C ne la touche plus jamais, quel que soit ce que dit un plan
  ré-appliqué plus tard.

## 5. Idempotence

Ré-appliquer exactement le même plan une seconde fois doit toujours
produire `created=0` sur toutes les tables et un `unchanged` égal au
nombre de lignes du plan (sauf `plant_source_records`, où un changement de
données réel produit un `updated` = supersession, jamais un doublon).
Ceci est vérifié par les tests unitaires (`test/apply/applyPlan.test.js`,
scénario "idempotence").

## 6. Limite connue : pas de transaction multi-table réelle

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
3. **Pas de fail-fast entre étapes** : une erreur sur une ligne n'empêche
   pas le traitement des autres lignes indépendantes, ni des étapes
   suivantes dont les dépendances ont réussi. Chaque erreur individuelle
   est collectée dans le rapport final (`report.steps.<table>.errors`),
   rien n'échoue silencieusement.

## 7. Vérification post-apply

`npm run plant:ingestion:verify` relit indépendamment chaque ligne décrite
par le plan et vérifie : existence, unicité (exactement 1 ligne), et
cohérence de clé étrangère (ex: une fiche catalogue pointe vers le bon
taxon). C'est une vérification en lecture seule, indépendante du rapport
que `applyCli.js` produit lui-même — elle sert de garde-fou contre un bug
de comptabilité dans la couche d'application.

## 8. Procédure de reprise après échec

Si `npm run plant:ingestion:apply -- --apply` échoue en cours de route
(réseau, contrainte DB, etc.) :

1. Consulter le rapport imprimé — chaque table indique `created`/`updated`/
   `unchanged`/`errors`, et chaque erreur nomme la ligne concernée.
2. Ne rien modifier à la main dans Supabase.
3. Relancer exactement la même commande. Grâce aux upserts sur clés
   naturelles, les lignes déjà écrites ne sont pas dupliquées — seules les
   lignes manquantes ou en erreur sont retentées.
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
