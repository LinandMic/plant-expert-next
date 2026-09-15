---
name: plant-ingestion
description: Work with the botanical data-ingestion pipeline (scripts/plant-ingestion) — collecting provider data, compiling/reviewing a transaction plan, and applying or verifying it against Supabase. Use whenever a task touches scripts/plant-ingestion/, plant-ingestion npm scripts, plant_catalog/plant_taxa/plant_trait_* Supabase tables, or the editorial/common-names overlay tools. Also use when asked to run, plan, review, or debug an ingestion batch, or to add a new species/cultivar/editorial curation entry.
---

# Plant Ingestion

This skill describes the **existing** pipeline exactly as documented in
`scripts/plant-ingestion/README.md` and implemented in
`scripts/plant-ingestion/src/`. It does not invent a new workflow — if
this file and the README ever disagree, the README and the code are
authoritative; treat the disagreement as a signal this skill needs
updating, not as license to improvise.

**Full invariant checklist:** `references/invariants.md` (same file the
`ingestion-plan-reviewer` subagent reads — read it before reviewing any
plan or reasoning about whether a change is safe).

## Mental model: four independent layers, one write boundary

```
Layer A (collect)  →  Layer B (plan)  →  Layer C (apply)  →  verify
index.js/bundle.js    planCli.js          applyCli.js          verifyCli.js
Perenual/Trefle/WCVP   plan/*.js           apply/*.js
dry-run, local JSON    pure, no I/O        ONLY layer that
only                                        writes to Supabase,
                                             and only with --apply

Editorial overlay (editorial/*.js, editorialCli.js) and common names
(commonNamesCli.js) are separate write paths with the same
--apply/--verify shape. They never replace Layer A/B/C — they patch in
traits/names no provider supplied, referencing a catalog_ref that must
already exist from a Layer C write.
```

Nothing in this pipeline modifies `pages/`, `components/`, `styles/`, or
the auth/garden/reminders/profile code — it is entirely separate from the
rest of the Next.js app.

## The one rule that matters most

**The only way any of this writes to Supabase is the literal `--apply`
flag** on `applyCli.js`, `editorialCli.js`, or `commonNamesCli.js`.
Everything else — `index.js`, `planCli.js`, `verifyCli.js`,
`filterPlanCli.js`, any of these three CLIs *without* `--apply`, and
`--verify` on any of them — is read-only or writes only to a local JSON
file.

**Claude Code must never pass `--apply`.** This is enforced mechanically,
not just by convention: the `guard-ingestion-apply` PreToolUse hook
(`.claude/hooks/guard-ingestion-apply.mjs`) blocks any Bash command that
would invoke one of the three CLIs with `--apply`. If you (Claude) are
asked to "run the ingestion" or "apply the plan," run everything through
the dry-run/plan/verify steps, hand the reviewed plan to the
`ingestion-plan-reviewer` subagent, and then tell the user the exact
command to run themselves, in their own terminal — do not attempt to run
it and do not try to work around the block.

## Standard commands

```bash
# Layer A — collect (never touches Supabase)
npm run plant:ingestion:dry-run

# Layer B — compile + validate a plan (pure, never touches Supabase)
npm run plant:ingestion:plan

# Layer C — dry-run apply (default; NO write, full accurate preview)
npm run plant:ingestion:apply

# Layer C — real apply (writes to Supabase) — USER RUNS THIS, NOT CLAUDE
npm run plant:ingestion:apply -- --apply

# Layer C — post-apply verification (read-only)
npm run plant:ingestion:verify

# Full test suite for Layers A/B/C + editorial (uses an in-memory fake
# Supabase client — no real project needed)
npm run plant:ingestion:test
```

A non-default batch (anything other than the Acer pilot) is passed
explicitly and does not touch the default output files:

```bash
node scripts/plant-ingestion/src/index.js \
  --plants scripts/plant-ingestion/<batch>.plants.json \
  --out scripts/plant-ingestion/output/<batch>-bundle.json

node scripts/plant-ingestion/src/planCli.js \
  --bundle scripts/plant-ingestion/output/<batch>-bundle.json \
  --plan scripts/plant-ingestion/output/<batch>-transaction-plan.json
```

Editorial overlay and common names follow the same `--input` /
`--catalog-map` / `[--apply] [--verify]` shape — see the README for the
`schema_version: 2` input format (`expert_knowledge` vs
`open_source_synthesis`).

## Workflow for adding or changing ingestion data

1. **Collect** (Layer A) for the target batch — local JSON only.
2. **Plan** (Layer B) — compiles and validates, still no Supabase.
3. **Review the plan** — hand the plan JSON to the `ingestion-plan-reviewer`
   subagent (or apply `references/invariants.md` yourself) before anyone
   runs `--apply`. This is the step that catches an invariant violation
   while it's still cheap to fix.
4. **Dry-run apply** (`npm run plant:ingestion:apply`, no flag) — confirm
   the preview matches expectations.
5. **Human runs `--apply`** themselves, outside Claude Code.
6. **Verify** (`npm run plant:ingestion:verify`) — read-only confirmation.
7. If curation is needed beyond what providers supply, use the editorial
   overlay (`editorialCli.js`) — same review-before-apply discipline.

## Recovery after a failed apply

Never hand-edit Supabase. Consult the printed report (each table shows
`created`/`updated`/`unchanged`/`errors`, or `SKIPPED
(reason=dependency_error: <table>)`), fix the underlying cause, and
re-run the **exact same command**. Natural-key upserts mean already-written
rows come back `unchanged`, not duplicated. Then re-run
`npm run plant:ingestion:verify`.

## Secrets

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` live only in
`scripts/plant-ingestion/.env.ingestion` (gitignored, never committed).
Never print, log, or repeat their values — the apply layer itself only
ever reports boolean presence (`hasUrl`/`hasServiceRoleKey`). If asked to
debug a missing-env-var failure, point to the `.env.ingestion.example`
template, don't ask for or paste the actual secret.

## Related automations

- **`ingestion-plan-reviewer` subagent** (`.claude/agents/ingestion-plan-reviewer.md`)
  — run this on any generated plan before telling the user it's ready for
  `--apply`.
- **`guard-ingestion-apply` hook** — the technical enforcement of "Claude
  never applies." If a legitimate dry-run or verify command ever gets
  blocked, that's a bug in the hook's regex, not a reason to bypass it —
  fix `.claude/hooks/guard-ingestion-apply.mjs`.
