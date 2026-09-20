-- Editorial provenance model v1. Additive only: no column dropped or
-- renamed, no existing row rewritten. Implements the provenance audit
-- from this chantier (see scripts/plant-ingestion/README.md, "Provenance
-- éditoriale") — the frozen semantics are:
--
--   plant_trait_observations.license      = licence/statut de la SOURCE
--                                            CONSULTÉE (unchanged meaning)
--   plant_trait_observations.curation_license = licence/statut de NOTRE
--                                            PROPRE observation/synthèse
--
-- curation_license must never be used to mask or replace the source's own
-- license/provenance (source_url/source_title/source_publisher/license
-- stay populated and truthful regardless of curation_license).

-- =============================================================================
-- 1. New provenance columns on plant_trait_observations.
-- =============================================================================
alter table public.plant_trait_observations
  add column source_title text null,
  add column source_publisher text null,
  add column curation_license text null,
  add column curated_by uuid null references auth.users (id) on delete set null,
  add column curation_method text null,
  add column reviewed_by uuid null references auth.users (id) on delete set null,
  add column reviewed_at timestamptz null;

-- curated_at is deliberately NOT added: created_at (already not null,
-- default now()) already represents when this curated fact entered the
-- system — an editorial row is only ever inserted after review is
-- complete (see buildEditorialObservation.js), so created_at is already
-- functionally equivalent to a "curated_at" for every row this pipeline
-- produces. Adding a second, always-identical timestamp column would be
-- pure duplication, not a real gap.

-- curation_method: schema allows all 3 values so the column never needs a
-- future migration to add "restricted_source_paraphrase" — but the
-- editorial CLI/validator (application layer, see
-- scripts/plant-ingestion/src/editorial/) currently REJECTS it. The
-- schema is intentionally more permissive than the product today.
alter table public.plant_trait_observations
  add constraint plant_trait_observations_curation_method_check
    check (curation_method is null or curation_method in (
      'expert_knowledge', 'open_source_synthesis', 'restricted_source_paraphrase'
    ));

create index plant_trait_observations_curated_by_idx on public.plant_trait_observations (curated_by);
create index plant_trait_observations_reviewed_by_idx on public.plant_trait_observations (reviewed_by);

-- =============================================================================
-- 2. Relax the editorial coherence check: source_retrieved_at was
--    previously FORCED null for every editorial row (source_scope=
--    'editorial'), even though an open_source_synthesis curation genuinely
--    consults a source at a real point in time and should be able to
--    record when. It is now ALLOWED (never required) for editorial rows.
--    Every other clause is byte-for-byte unchanged: provider='editorial'
--    <=> source_scope='editorial' <=> plant_source_record_id IS NULL, and
--    a non-editorial row is unaffected (still requires
--    plant_source_record_id and source_retrieved_at both NOT NULL).
--    This is strictly LOOSER than the constraint it replaces — every
--    existing row (editorial rows all have source_retrieved_at IS NULL
--    today, per the old constraint) is still valid, unchanged, and
--    unre-written by this migration.
-- =============================================================================
alter table public.plant_trait_observations
  drop constraint plant_trait_observations_editorial_coherence_check;

alter table public.plant_trait_observations
  add constraint plant_trait_observations_editorial_coherence_check
    check (
      (provider = 'editorial' and source_scope = 'editorial' and plant_source_record_id is null)
      or
      (provider <> 'editorial' and source_scope in ('trait', 'record') and plant_source_record_id is not null and source_retrieved_at is not null)
    );
