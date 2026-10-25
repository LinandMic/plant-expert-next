-- Plant catalog garden uses v1.
--
-- Adds plant_catalog.garden_uses (text[], nullable): the garden-use
-- categories a catalog plant belongs to IN ADDITION to its botanical
-- plant_type — vegetable, fruit, herb, rose. NULL = no particular use
-- (ornamental by default), never an empty array (same convention as sun).
-- Named garden_uses, not usage: public.plants.usage already exists with a
-- different meaning (growing form: haie_taillee, massif, potager…).
-- Filled only by the editorial overlay (no provider supplies it); written
-- one column at a time by scripts/plant-ingestion/src/editorial/
-- promoteCatalogTrait.js, never by the provider catalog upsert.
--
-- Backward compatibility: the column is nullable with no default, so no
-- existing row and no existing writer changes. Existing readers select
-- explicit column lists (lib/gardenApi.js, lib/plantFinderApi.js) and never
-- see it. The search RPC gains ONE trailing parameter with a default;
-- PostgREST resolves an RPC call by its named arguments, so a client that
-- still sends only the 7 previous arguments (the app currently in
-- production) resolves to this new function unchanged — garden_use_filter
-- falls back to null, i.e. exactly the previous behavior. The one visible
-- change for such a client is an extra garden_uses key on each returned
-- row, which lib/plantFinderApi.js's rpcRowToPlant ignores.
--
-- The old 7-argument function is DROPPED rather than kept as an overload:
-- with two candidates, a 7-named-argument call would match both and
-- PostgREST would refuse it as ambiguous. Drop + create run in the same
-- migration transaction, so no caller ever sees the function missing.

alter table public.plant_catalog
  add column garden_uses text[] null;

alter table public.plant_catalog
  add constraint plant_catalog_garden_uses_check
    check (
      garden_uses is null
      or (cardinality(garden_uses) > 0
          and garden_uses <@ array['vegetable', 'fruit', 'herb', 'rose']::text[])
    );

-- Every clause besides the garden_uses column and the garden_use_filter
-- predicate is byte-for-byte unchanged from
-- 20260914100000_add_common_name_display_v1.sql.
drop function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer);

create function public.search_published_plants(
  search_query text default null,
  plant_type_filter text default null,
  sun_filter text[] default null,
  height_min numeric default null,
  height_max numeric default null,
  result_limit integer default 20,
  result_offset integer default 0,
  garden_use_filter text default null
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
      pc.garden_uses,
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
      and (garden_use_filter is null or pc.garden_uses @> array[garden_use_filter])
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

comment on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer, text) is
  'Plant Finder search: published plant_catalog rows matched by display_name/common_name/cultivar_name, any plant_taxon_names synonym, or any plant_common_names vernacular name (fr or en) for the same taxon — case- and accent-insensitive throughout. Optional filters: plant_type (equality), sun (overlap), height_max_cm bounds, garden use (garden_uses contains the value). Returns {total, rows} in one round trip, each row also carrying garden_uses and preferred_common_name_fr/preferred_common_name_en (nullable) via an indexed lateral lookup on plant_common_names_one_preferred_per_taxon_locale. See lib/plantFinderApi.js.';

revoke all on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer, text) from public;
grant execute on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
