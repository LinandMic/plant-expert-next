# Plant-ingestion invariants (source of truth: scripts/plant-ingestion/README.md and code)

This file is the single canonical checklist of the pipeline's safety
invariants. It is read by both the `plant-ingestion` skill and the
`ingestion-plan-reviewer` subagent so the two never drift apart. Every
entry below cites the file that enforces it — if the code changes, update
this list from the code, not the other way around.

## Layer boundaries

- Layer A (`index.js`, `bundle.js`) — dry-run collection from
  Perenual/Trefle/GBIF-WCVP. Never touches Supabase.
- Layer B (`planCli.js`, `plan/*.js`) — pure compilation of a bundle into a
  transaction plan. No network I/O, no Supabase.
- Layer C (`applyCli.js`, `verifyCli.js`, `apply/*.js`) — the only layer
  that writes to Supabase, and only when invoked with `--apply`.
- Editorial overlay (`editorialCli.js`, `editorial/*.js`) and common names
  (`commonNamesCli.js`) — separate write paths, same `--apply`/`--verify`
  shape as Layer C, never a replacement for Layer A/B/C.

## The write boundary

- [ ] **`approval_required: true`** is present on every plan Layer B
  produces (`plan/*.js`). A plan without it is malformed — treat as a
  blocking finding, not a warning.
- [ ] The **only** way any CLI writes to Supabase is the literal `--apply`
  flag on `applyCli.js`, `editorialCli.js`, or `commonNamesCli.js`. No
  other flag, env var, or code path triggers a write. (Enforced for Claude
  Code specifically by the `guard-ingestion-apply` PreToolUse hook — see
  `.claude/hooks/guard-ingestion-apply.mjs`.)
- [ ] `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are server/local-only,
  never `NEXT_PUBLIC_`-prefixed, never logged (only `hasUrl`/
  `hasServiceRoleKey` booleans are ever reported —
  `apply/supabaseConfig.js`). A reviewer must never quote, paste, or
  reproduce the actual value of either variable.

## Curator-owned fields (`plant_catalog`)

- [ ] `publication_status`, `review_status`, `published_at` must be
  `draft` / `unreviewed` / (plan-supplied) on every plan — Layer B
  invariants O/P. A plan proposing any other value for these three fields
  on creation is a blocking finding.
- [ ] These three fields must **never** be rewritten on an update. If a
  plan or promotion appears to touch them on an existing row, that is a
  blocking finding — reapplying an ingestion plan must never silently
  unpublish or reset curator review state.

## `plant_trait_selections` / `decision_method`

- [ ] `decision_method` is one of exactly three values:
  `provider_observation`, `editorial`, `manual_resolution`.
- [ ] Layer B (`plan/compileSelections.js`) must never produce
  `manual_resolution` in a plan. If a generated plan contains it, that is
  a blocking finding — it means something upstream is fabricating a
  decision that must only ever come from a human curator.
- [ ] A DB row with `decision_method = "manual_resolution"` must never be
  overwritten by a plan, regardless of what the plan recommends. Check
  whether the plan/report claims to update a selection that the
  DB-side data (or the report's own `unchanged` reporting) indicates is
  `manual_resolution` — if so, any non-`unchanged` outcome is a blocking
  finding (anti-clobber, `test/apply/upsertSelections.test.js` test 6).

## Append-only observations

- [ ] `plant_trait_observations` is append-only by design. A report or
  plan expecting an `updated` outcome for this table is a blocking
  finding — only `created`/`unchanged`/`failed` are valid.
- [ ] Accounting invariant: for every table in an apply report,
  `created + updated + unchanged + failed` must equal the number of input
  rows for that table. A mismatch (`accounting mismatch: input=N
  accounted=M`) is a blocking finding, never something to wave through.
- [ ] A row whose DB lookup fails must be counted `failed`, never
  fabricated as `created`.

## Editorial overlay specifics (`editorial/*.js`)

- [ ] `schema_version` must be `2`. An older/missing-version input must be
  rejected explicitly (`SCHEMA_VERSION_UNSUPPORTED`) — never
  reinterpreted, and an old `source.license` must never silently become
  `curation_license`.
- [ ] `curation.method` must be in the **enabled** set
  (`expert_knowledge`, `open_source_synthesis`). `restricted_source_paraphrase`
  is schema-legal but product-rejected (`CURATION_METHOD_NOT_ENABLED`) —
  a plan/input using it is a blocking finding, not something to silently
  downgrade to another method.
- [ ] `expert_knowledge` entries must have `source: null` (never a
  fabricated source) and a non-empty `review.note`.
- [ ] `open_source_synthesis` entries must have a complete `source` block
  (`title`, `publisher`, `url`, `license`, `retrieved_at`) — `license:
  "unknown"` is always invalid.
- [ ] `curation_license` and `license` are distinct fields and must never
  be merged, derived from each other, or used to mask one another.
- [ ] `promoteCatalogTrait.js` is the only path that lets editorial
  curation write to `plant_catalog`, and it must touch **exactly one
  column**. A plan/promotion that appears to update more than one
  `plant_catalog` column in a single editorial operation is a blocking
  finding — it means `apply/upsertCatalogEntries.js` (full-row update) was
  reused where it must never be.

## Provider neutrality

- [ ] No provider (Perenual/Trefle/GBIF-WCVP) may be hardcoded as
  higher-priority. A `trait_selection` may only be proposed when **all**
  non-`uncertain` observations for that trait, across all providers,
  agree on the same normalized value. A plan that picks a value despite
  documented provider disagreement is a blocking finding.
- [ ] Only these traits may ever carry an automatic `trait_selection`:
  `height_min_cm`, `height_max_cm`, `plant_type`, `growth_form`,
  `spread_max_cm`, `evergreen`, `flowering_months`, `sun`. Any other trait
  (e.g. `water_need`, `edible*`, `hardiness_*_rank`, `container_suitable`)
  appearing as a `trait_selection` in a plan is a blocking finding — those
  traits may only ever have `trait_observations`.

## Dependency graph / partial-failure behavior (`apply/applyPlan.js`)

- [ ] Write order is fixed: `taxa → taxon_names → catalog_entries →
  source_records → trait_observations → trait_selections`.
- [ ] When a parent table's step errors, every table that depends on it by
  real FK must be reported `status: "skipped"`, `reason:
  "dependency_error: <table>"` — never silently attempted, never counted
  toward `created`/`updated`/`unchanged`.
- [ ] This applies identically in dry-run: a dry-run must never claim a
  dependent step "would succeed" when its parent errored.

## Idempotence

- [ ] Re-applying the exact same plan a second time must show `created=0`
  on every table and `unchanged` equal to the plan's row count — except
  `plant_source_records` (a genuine data change produces `updated`, never
  a duplicate) and `plant_trait_selections` (a genuine change to an
  **automatic** selection produces `updated`; `manual_resolution` stays
  `unchanged` by construction).

## What is explicitly out of scope for the reviewer

- Taxonomy resolution correctness against WCVP (trust the schema
  CHECK / Layer B's `accepted`-only compilation).
- Whether a `quality_status` (`draft`/`ready_searchable`/`ready_complete`)
  is "good enough" to publish — that is a curator judgment call,
  `computePlantCompleteness()` is informational only and this pipeline
  never auto-publishes.
- Performance/cost of the underlying provider API calls.
