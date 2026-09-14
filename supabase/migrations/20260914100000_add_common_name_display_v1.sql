-- Common-name display v1: extends search_published_plants to also return
-- each row's preferred French and English common name (from
-- plant_common_names), so Plant Finder cards can show a locale-aware
-- vernacular title without a second round trip per row.
--
-- NOT APPLIED LIVE THIS ROUND — prepared and validated via a rolled-back
-- transaction against the live project only, matching this migration's own
-- predecessor's practice (20260911140000_add_plant_common_names_v1.sql).
-- Plant Detail's common-name display (this round's other half) needed no
-- schema change at all: it reads plant_common_names through a plain
-- embedded PostgREST select, which the existing public SELECT policy
-- already allows.
--
-- Every clause besides the two new preferred-name columns is byte-for-byte
-- unchanged from 20260911140000_add_plant_common_names_v1.sql. Signature is
-- unchanged — no client code needs to change its RPC *call*, only how it
-- reads the two new fields on each returned row (see
-- lib/plantFinderApi.js's rpcRowToPlant).
--
-- The lateral join reads a single row (or none) per taxon via
-- plant_common_names_one_preferred_per_taxon_locale — the same unique
-- partial index that already enforces "at most one preferred name per
-- taxon+locale" — so this is an indexed point lookup per row, not a
-- sequential scan, and it stays a single query (no N+1 from the app tier:
-- one RPC round trip still returns every row's preferred names inline).
create or replace function public.search_published_plants(
  search_query text default null,
  plant_type_filter text default null,
  sun_filter text[] default null,
  height_min numeric default null,
  height_max numeric default null,
  result_limit integer default 20,
  result_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with normalized as (
    select case
      when search_query is null or btrim(search_query) = '' then null
      else lower(public.immutable_unaccent(btrim(search_query)))
    end as q
  ),
  escaped as (
    select case
      when q is null then null
      else replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_')
    end as q_escaped
    from normalized
  ),
  matched as (
    select
      pc.id, pc.slug, pc.entry_type, pc.cultivar_name, pc.display_name, pc.common_name,
      pc.plant_type, pc.growth_form, pc.height_min_cm, pc.height_max_cm, pc.spread_max_cm,
      pc.sun, pc.evergreen, pc.water_need, pc.container_suitable, pc.edible, pc.flowering_months,
      pc.image_url, pc.image_alt, pc.image_author, pc.image_license, pc.image_source_url,
      pt.canonical_name, pt.family, pt.genus,
      pref.preferred_common_name_fr, pref.preferred_common_name_en
    from public.plant_catalog pc
    join public.plant_taxa pt on pt.id = pc.taxon_id
    left join lateral (
      select
        max(name) filter (where locale = 'fr') as preferred_common_name_fr,
        max(name) filter (where locale = 'en') as preferred_common_name_en
      from public.plant_common_names pcn
      where pcn.taxon_id = pt.id and pcn.is_preferred
    ) pref on true
    cross join escaped
    where pc.publication_status = 'published'
      and (
        escaped.q_escaped is null
        or lower(public.immutable_unaccent(pc.display_name)) like '%' || escaped.q_escaped || '%' escape '\'
        or (pc.common_name is not null and lower(public.immutable_unaccent(pc.common_name)) like '%' || escaped.q_escaped || '%' escape '\')
        or (pc.cultivar_name is not null and lower(public.immutable_unaccent(pc.cultivar_name)) like '%' || escaped.q_escaped || '%' escape '\')
        or exists (
          select 1 from public.plant_taxon_names ptn
          where ptn.taxon_id = pc.taxon_id
            and lower(public.immutable_unaccent(ptn.name)) like '%' || escaped.q_escaped || '%' escape '\'
        )
        or exists (
          select 1 from public.plant_common_names pcn
          where pcn.taxon_id = pc.taxon_id
            and pcn.normalized_name like '%' || escaped.q_escaped || '%' escape '\'
        )
      )
      and (plant_type_filter is null or pc.plant_type = plant_type_filter)
      and (sun_filter is null or pc.sun && sun_filter)
      and (height_min is null or pc.height_max_cm > height_min)
      and (height_max is null or pc.height_max_cm <= height_max)
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce(
      (
        select jsonb_agg(to_jsonb(page) order by page.display_name, page.id)
        from (
          select * from matched
          order by display_name asc, id asc
          limit result_limit offset result_offset
        ) page
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer) is
  'Plant Finder search: published plant_catalog rows matched by display_name/common_name/cultivar_name, any plant_taxon_names synonym, or any plant_common_names vernacular name (fr or en) for the same taxon — case- and accent-insensitive throughout. Returns {total, rows} in one round trip, each row also carrying preferred_common_name_fr/preferred_common_name_en (nullable) via an indexed lateral lookup on plant_common_names_one_preferred_per_taxon_locale — no second query needed per row. See lib/plantFinderApi.js.';
