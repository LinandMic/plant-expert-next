-- Catalog -> My Garden link v1.
--
-- Audit finding (this round): public.plants has NO column linking a garden
-- plant back to its catalog/taxon identity — every field (common_name,
-- latin_name, family, category, ...) is free text, and the only existing
-- insert path (gardenApi.insertPlant, via useGarden's addPlant) is shaped
-- entirely around the AI-identification flow's own payload
-- (identite.nom_commun/nom_latin/famille/categorie, confiance, ai_data).
-- Wrapping a Plant Finder catalog plant into that shape would mean
-- inventing a fake confidence score and a fake ai_data blob — explicitly
-- disallowed. This migration instead adds three new, entirely optional
-- columns so a garden plant added FROM the catalog can stay linked to its
-- real plant_catalog/plant_taxa identity, without touching the AI flow at
-- all.
--
-- NOT APPLIED LIVE THIS ROUND — prepared and validated via a rolled-back
-- transaction against the live project only, matching every other
-- schema-touching round in this engagement. This round's own instructions
-- are commit/push=false regardless, so nothing goes live either way; a
-- later round would apply this explicitly, the same way
-- 20260914100000_add_common_name_display_v1.sql was applied in its own
-- dedicated round after this same kind of prepare-first step.
--
-- Every new column is nullable (source excepted, which is NOT NULL but
-- DEFAULTs to 'ai_identification' — see below) — every existing row, and
-- every row the untouched AI-identification insert path
-- (gardenApi.insertPlant) will ever write, is completely unaffected: it
-- simply never sets these columns, and they stay null / take the default.
-- ON DELETE SET NULL on both new FKs (never CASCADE): a user's own garden
-- plant must never be silently deleted just because a catalog entry or
-- taxon is later archived/removed — the plant is the user's data, the
-- catalog link is reference metadata on top of it.
alter table public.plants
  add column if not exists source text not null default 'ai_identification',
  add column if not exists catalog_plant_id uuid null references public.plant_catalog (id) on delete set null,
  add column if not exists taxon_id uuid null references public.plant_taxa (id) on delete set null;

alter table public.plants
  drop constraint if exists plants_source_check;
alter table public.plants
  add constraint plants_source_check
  check (source in ('ai_identification', 'catalog'));

create index if not exists plants_catalog_plant_id_idx
  on public.plants (catalog_plant_id)
  where catalog_plant_id is not null;

create index if not exists plants_taxon_id_idx
  on public.plants (taxon_id)
  where taxon_id is not null;

comment on column public.plants.source is
  'Where this garden plant originated: ai_identification (the existing photo/name identification flow — default, preserves every current row unchanged) or catalog (added directly from a published Plant Finder entry, see catalog_plant_id/taxon_id).';
comment on column public.plants.catalog_plant_id is
  'The plant_catalog.id this garden plant was added from, when source=catalog. Null for ai_identification rows and for any catalog-sourced plant whose catalog entry has since been removed (ON DELETE SET NULL — the garden plant itself is never deleted).';
comment on column public.plants.taxon_id is
  'The plant_taxa.id this garden plant corresponds to, when known (always set alongside catalog_plant_id for source=catalog; never set by the AI-identification flow, which has no taxonomy resolution). Preserves canonical species identity independent of catalog_plant_id, e.g. if the catalog entry is later restructured.';

-- RLS is unaffected: plants_select_own/insert_own/update_own/delete_own
-- (20260820132941_create_user_plants_and_photos.sql) are all row-scoped on
-- user_id, not column-scoped, so they already cover these new columns with
-- no policy change needed.
