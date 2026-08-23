-- Plant Finder V1 catalog schema.
-- Adds 6 new tables only. Does not touch profiles, plants, plant_photos,
-- plant_reminders, garden_zones, or any existing extension/default privilege.
-- No extension created: gen_random_uuid() is already available via pgcrypto.

-- =============================================================================
-- 1. plant_taxa — WCVP botanical backbone. Taxonomic layer only: may hold any
--    validated rank, including genus. Only accepted taxa are stored here;
--    synonyms are tracked in plant_taxon_names. plant_catalog is the layer
--    restricted to species/cultivar entries; the DB does not enforce that a
--    plant_catalog row cannot reference a genus-rank taxon (no trigger for
--    that in V1) — the ingestion/catalog-curation path is responsible for
--    rejecting rank='genus' when creating a recommendable entry. This is an
--    application-level invariant, not a database-level one.
-- =============================================================================
create table public.plant_taxa (
  id uuid primary key default gen_random_uuid(),
  rank text not null,
  genus text not null,
  species text null,
  infraspecific_epithet text null,
  canonical_name text not null,
  scientific_name_full text null,
  family text null,
  taxonomic_status text not null,
  wcvp_taxon_id text not null,
  parent_taxon_id uuid null references public.plant_taxa (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plant_taxa_wcvp_taxon_id_unique unique (wcvp_taxon_id),
  constraint plant_taxa_rank_check
    check (rank in ('genus', 'species', 'subspecies', 'variety', 'form')),
  constraint plant_taxa_taxonomic_status_check
    check (taxonomic_status = 'accepted')
);

-- =============================================================================
-- 2. plant_taxon_names — accepted name + synonyms per taxon. normalized_name
--    is not globally unique: homonyms (same name, different taxon) remain
--    representable.
-- =============================================================================
create table public.plant_taxon_names (
  id uuid primary key default gen_random_uuid(),
  taxon_id uuid not null references public.plant_taxa (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  name_type text not null,
  source_taxon_id text null,
  created_at timestamptz not null default now(),

  constraint plant_taxon_names_name_type_check
    check (name_type in ('accepted', 'synonym')),
  constraint plant_taxon_names_taxon_normalized_name_unique
    unique (taxon_id, normalized_name)
);

create index plant_taxon_names_normalized_name_idx on public.plant_taxon_names (normalized_name);

-- One accepted name per taxon.
create unique index plant_taxon_names_one_accepted_per_taxon
  on public.plant_taxon_names (taxon_id)
  where name_type = 'accepted';

-- =============================================================================
-- 3. plant_catalog — app-controlled catalog entries (species or cultivar,
--    never genus). parent_catalog_id is grouping/navigation only — no
--    automatic trait inheritance. Unknown = NULL, never an empty array.
-- =============================================================================
create table public.plant_catalog (
  id uuid primary key default gen_random_uuid(),
  taxon_id uuid not null references public.plant_taxa (id) on delete restrict,
  parent_catalog_id uuid null references public.plant_catalog (id) on delete restrict,
  entry_type text not null,
  cultivar_name text null,
  display_name text not null,
  common_name text null,
  slug text not null,
  publication_status text not null default 'draft',
  review_status text not null default 'unreviewed',
  published_at timestamptz null,

  plant_type text null,
  growth_form text null,

  height_min_cm numeric null,
  height_max_cm numeric null,
  spread_max_cm numeric null,

  sun text[] null,

  hardiness_min_rank smallint null,
  hardiness_max_rank smallint null,

  evergreen boolean null,
  water_need text null,
  container_suitable boolean null,
  edible boolean null,

  flowering_months smallint[] null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plant_catalog_slug_unique unique (slug),

  constraint plant_catalog_entry_type_check
    check (entry_type in ('species', 'cultivar')),
  constraint plant_catalog_publication_status_check
    check (publication_status in ('draft', 'published', 'archived')),
  constraint plant_catalog_review_status_check
    check (review_status in ('unreviewed', 'needs_review', 'reviewed')),

  constraint plant_catalog_cultivar_coherence_check
    check (
      (entry_type = 'species' and cultivar_name is null and parent_catalog_id is null)
      or
      (entry_type = 'cultivar' and cultivar_name is not null and parent_catalog_id is not null)
    ),

  constraint plant_catalog_height_min_check check (height_min_cm is null or height_min_cm >= 0),
  constraint plant_catalog_height_max_check check (height_max_cm is null or height_max_cm >= 0),
  constraint plant_catalog_spread_max_check check (spread_max_cm is null or spread_max_cm >= 0),
  constraint plant_catalog_height_order_check
    check (height_min_cm is null or height_max_cm is null or height_min_cm <= height_max_cm),

  -- No 1..13 bound: the USDA crosswalk does not exist yet, only relative order.
  constraint plant_catalog_hardiness_order_check
    check (hardiness_min_rank is null or hardiness_max_rank is null or hardiness_min_rank <= hardiness_max_rank),

  -- NULL = unknown. Never an empty array. 'unknown' is never a valid array value here.
  constraint plant_catalog_sun_check
    check (
      sun is null
      or (cardinality(sun) > 0 and sun <@ array['full_sun', 'partial_sun', 'bright_shade', 'shade']::text[])
    ),
  constraint plant_catalog_flowering_months_check
    check (
      flowering_months is null
      or (cardinality(flowering_months) > 0 and flowering_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])
    )
);

-- One species-type catalog entry per taxon.
create unique index plant_catalog_one_species_per_taxon
  on public.plant_catalog (taxon_id)
  where entry_type = 'species';

-- Normalized cultivar-name uniqueness within a given taxon.
create unique index plant_catalog_cultivar_name_unique_per_taxon
  on public.plant_catalog (taxon_id, lower(btrim(cultivar_name)))
  where entry_type = 'cultivar';

create index plant_catalog_publication_status_idx on public.plant_catalog (publication_status);
create index plant_catalog_taxon_id_idx on public.plant_catalog (taxon_id);
create index plant_catalog_parent_catalog_id_idx on public.plant_catalog (parent_catalog_id);

create index plant_catalog_display_name_prefix_idx
  on public.plant_catalog (lower(display_name) text_pattern_ops);

create index plant_catalog_common_name_prefix_idx
  on public.plant_catalog (lower(common_name) text_pattern_ops)
  where common_name is not null;

create index plant_catalog_cultivar_name_prefix_idx
  on public.plant_catalog (lower(cultivar_name) text_pattern_ops)
  where cultivar_name is not null;

create index plant_catalog_plant_type_idx on public.plant_catalog (plant_type);

create index plant_catalog_height_min_cm_idx on public.plant_catalog (height_min_cm);
create index plant_catalog_height_max_cm_idx on public.plant_catalog (height_max_cm);
create index plant_catalog_spread_max_cm_idx on public.plant_catalog (spread_max_cm);

create index plant_catalog_sun_gin_idx on public.plant_catalog using gin (sun);

create index plant_catalog_hardiness_min_rank_idx on public.plant_catalog (hardiness_min_rank);
create index plant_catalog_hardiness_max_rank_idx on public.plant_catalog (hardiness_max_rank);

create index plant_catalog_flowering_months_gin_idx on public.plant_catalog using gin (flowering_months);

-- =============================================================================
-- 4. plant_source_records — append-only, one row per provider fetch attempt.
--    superseded_at is null for the current row; a new fetch supersedes the
--    previous one rather than overwriting it, preserving history. No raw
--    provider payload is stored in this table.
-- =============================================================================
create table public.plant_source_records (
  id uuid primary key default gen_random_uuid(),
  plant_catalog_id uuid not null references public.plant_catalog (id) on delete cascade,
  provider text not null,
  provider_record_id text null,
  provider_name text null,
  provider_status text not null,
  selection_reason text null,
  taxonomy_match_type text null,
  candidate_count integer null,
  retrieved_at timestamptz not null,
  source_url text null,
  metadata jsonb null,
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint plant_source_records_provider_status_check
    check (provider_status in ('ok', 'not_found', 'plan_restricted', 'unresolved_under_plan', 'provider_error', 'skipped_no_key')),
  constraint plant_source_records_selection_reason_check
    check (selection_reason is null or selection_reason in (
      'exact_scientific_match', 'exact_cultivar_match', 'parent_taxon_match', 'parent_only',
      'ambiguous', 'fuzzy_candidate', 'not_found', 'plan_restricted', 'unresolved_under_plan',
      'provider_error', 'skipped_no_key'
    )),
  constraint plant_source_records_taxonomy_match_type_check
    check (taxonomy_match_type is null or taxonomy_match_type in (
      'exact_accepted_match', 'synonym_match', 'parent_taxon_match', 'ambiguous', 'not_found', 'taxonomy_conflict'
    )),
  constraint plant_source_records_candidate_count_check
    check (candidate_count is null or candidate_count >= 0)
);

-- Technical composite unique, used only as the target of the composite FK
-- from plant_trait_observations (see below).
alter table public.plant_source_records
  add constraint plant_source_records_id_catalog_provider_unique unique (id, plant_catalog_id, provider);

-- One current (non-superseded) record per provider per catalog entry.
create unique index plant_source_records_one_current_per_provider
  on public.plant_source_records (plant_catalog_id, provider)
  where superseded_at is null;

-- =============================================================================
-- 5. plant_trait_observations — individual raw observations of a trait, from
--    either an external provider fetch or an editorial (manually curated)
--    entry. trait and provider are intentionally not CHECK-restricted: the
--    system stays extensible. One canonical value is later chosen among
--    these observations in plant_trait_selections.
-- =============================================================================
create table public.plant_trait_observations (
  id uuid primary key default gen_random_uuid(),
  plant_catalog_id uuid not null references public.plant_catalog (id) on delete cascade,
  trait text not null,
  provider text not null,
  field_path text null,
  raw_value jsonb null,
  raw_unit text null,
  normalized_value jsonb null,
  normalized_unit text null,
  plant_source_record_id uuid null,
  source_url text null,
  attribution text null,
  license text null,
  source_retrieved_at timestamptz null,
  uncertain boolean not null default false,
  source_scope text not null,
  review_status text not null default 'unreviewed',
  created_at timestamptz not null default now(),

  constraint plant_trait_observations_source_scope_check
    check (source_scope in ('trait', 'record', 'editorial')),
  constraint plant_trait_observations_review_status_check
    check (review_status in ('unreviewed', 'accepted', 'rejected')),

  -- Editorial/external coherence: an editorial observation never carries
  -- source-record provenance; a provider observation always must. Trefle
  -- observations use source_scope='record' even when field_path is precise,
  -- because Trefle provenance is only ever proven at the record level.
  constraint plant_trait_observations_editorial_coherence_check
    check (
      (provider = 'editorial' and source_scope = 'editorial' and plant_source_record_id is null and source_retrieved_at is null)
      or
      (provider <> 'editorial' and source_scope in ('trait', 'record') and plant_source_record_id is not null and source_retrieved_at is not null)
    ),

  -- Composite FK to plant_source_records. MATCH SIMPLE (Postgres default)
  -- skips this check entirely when plant_source_record_id is null, which is
  -- exactly the editorial case allowed above.
  constraint plant_trait_observations_source_record_fk
    foreign key (plant_source_record_id, plant_catalog_id, provider)
    references public.plant_source_records (id, plant_catalog_id, provider)
);

-- Technical composite unique, used only as the target of the composite FK
-- from plant_trait_selections (see below).
alter table public.plant_trait_observations
  add constraint plant_trait_observations_id_catalog_trait_unique unique (id, plant_catalog_id, trait);

create index plant_trait_observations_catalog_trait_idx
  on public.plant_trait_observations (plant_catalog_id, trait);
create index plant_trait_observations_source_record_id_idx
  on public.plant_trait_observations (plant_source_record_id);

-- =============================================================================
-- 6. plant_trait_selections — the canonical, currently-selected observation
--    for a given (catalog entry, trait). Every canonical value must be
--    backed by a real observation, including editorial ones: they too go
--    through plant_trait_observations.
-- =============================================================================
create table public.plant_trait_selections (
  id uuid primary key default gen_random_uuid(),
  plant_catalog_id uuid not null references public.plant_catalog (id) on delete cascade,
  trait text not null,
  selected_observation_id uuid not null,
  decision_method text not null,
  decided_at timestamptz not null default now(),
  decided_by uuid null references auth.users (id) on delete set null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plant_trait_selections_decision_method_check
    check (decision_method in ('provider_observation', 'editorial', 'manual_resolution')),
  constraint plant_trait_selections_one_per_catalog_trait
    unique (plant_catalog_id, trait),

  -- Composite FK guarantees the selected observation actually belongs to
  -- this same catalog entry and trait, not merely to any row by id.
  constraint plant_trait_selections_observation_fk
    foreign key (selected_observation_id, plant_catalog_id, trait)
    references public.plant_trait_observations (id, plant_catalog_id, trait)
);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.plant_taxa enable row level security;
alter table public.plant_taxon_names enable row level security;
alter table public.plant_catalog enable row level security;
alter table public.plant_source_records enable row level security;
alter table public.plant_trait_observations enable row level security;
alter table public.plant_trait_selections enable row level security;

-- Backbone reference data: safe to expose in full.
create policy plant_taxa_public_select
  on public.plant_taxa
  for select
  to anon, authenticated
  using (true);

create policy plant_taxon_names_public_select
  on public.plant_taxon_names
  for select
  to anon, authenticated
  using (true);

-- Catalog entries: only published rows are public.
create policy plant_catalog_published_select
  on public.plant_catalog
  for select
  to anon, authenticated
  using (publication_status = 'published');

-- plant_source_records, plant_trait_observations and plant_trait_selections
-- are internal audit/provenance tables. They are never exposed to anon or
-- authenticated. RLS is enabled with no policy for those roles on these 3
-- tables, so access is denied by default (only service_role, which bypasses
-- RLS, can read or write them).

-- =============================================================================
-- Grants (explicit per new table; existing ALTER DEFAULT PRIVILEGES untouched)
-- =============================================================================
revoke all on public.plant_taxa from public, anon, authenticated;
revoke all on public.plant_taxon_names from public, anon, authenticated;
revoke all on public.plant_catalog from public, anon, authenticated;
revoke all on public.plant_source_records from public, anon, authenticated;
revoke all on public.plant_trait_observations from public, anon, authenticated;
revoke all on public.plant_trait_selections from public, anon, authenticated;

grant select on public.plant_taxa to anon, authenticated;
grant select on public.plant_taxon_names to anon, authenticated;
grant select on public.plant_catalog to anon, authenticated;
-- No grant to anon/authenticated on plant_source_records,
-- plant_trait_observations or plant_trait_selections: they stay internal.

grant select, insert, update, delete on public.plant_taxa to service_role;
grant select, insert, update, delete on public.plant_taxon_names to service_role;
grant select, insert, update, delete on public.plant_catalog to service_role;
grant select, insert, update, delete on public.plant_source_records to service_role;
grant select, insert, update, delete on public.plant_trait_observations to service_role;
grant select, insert, update, delete on public.plant_trait_selections to service_role;
