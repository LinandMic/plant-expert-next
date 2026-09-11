-- Plant Finder search fix: the client-side search (lib/plantFinderApi.js)
-- only ever queried plant_catalog.display_name/common_name/cultivar_name
-- with a plain case-sensitive-on-accents ilike, and NEVER queried
-- plant_taxon_names (the WCVP scientific-synonym table, 1187+ real rows) at
-- all. Root-cause audit found ZERO published plant_catalog rows have a
-- common_name today (0/22) — that half of the reported bug ("lavande"
-- returns nothing) is a data gap, not a code bug, and is intentionally NOT
-- addressed here (no invented/guessed common names). The code gap that IS
-- fixable without new data: synonym search was wired to nothing, and
-- nothing was accent-insensitive (so a future "hortensia" or "érable"
-- common name, or an existing accented synonym, still wouldn't match
-- "erable"). This migration adds both, server-side, in one query.
--
-- unaccent: a stock, non-destructive Postgres extension (strips diacritics
-- for comparison only — never rewrites stored data). Not installed before
-- this migration (confirmed via live inspection).
create extension if not exists unaccent with schema extensions;

-- search_published_plants(...) -> jsonb { total, rows }
-- Single round trip, no N+1: `matched` is evaluated once and reused both
-- for the exact total (over the FULL matching set, decoupled from
-- limit/offset — unlike a `count(*) over()` window column, this stays
-- correct even for a page whose slice comes back empty) and for the
-- requested page of rows. SECURITY INVOKER (the default) — this function
-- carries no elevated privilege; it runs as the calling anon/authenticated
-- role, so plant_catalog_published_select's RLS policy (publication_status
-- = 'published') already applies on its own. The explicit
-- publication_status filter below is defense-in-depth, exactly like the
-- .eq("publication_status","published") this replaces in
-- lib/plantFinderApi.js — never a substitute for RLS, and it means a draft
-- row can never leak through this function even if RLS were ever
-- misconfigured.
--
-- Matching: display_name / common_name / cultivar_name (own row) OR any
-- plant_taxon_names.name for the same taxon_id (accepted name AND
-- synonyms — e.g. an old/reclassified Latin name a user might still
-- search). Every side of every comparison is lower()+unaccent()'d, so the
-- match is both case- and accent-insensitive. The search term is escaped
-- for LIKE metacharacters (%, _, \) before use — it is a bound SQL
-- parameter throughout (never string-concatenated into executable SQL),
-- so this is not a SQL-injection vector; the escaping here only stops a
-- literal "%" or "_" typed by a visitor from acting as a wildcard.
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
      else lower(extensions.unaccent(btrim(search_query)))
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
      pt.canonical_name, pt.family, pt.genus
    from public.plant_catalog pc
    join public.plant_taxa pt on pt.id = pc.taxon_id
    cross join escaped
    where pc.publication_status = 'published'
      and (
        escaped.q_escaped is null
        or lower(extensions.unaccent(pc.display_name)) like '%' || escaped.q_escaped || '%' escape '\'
        or (pc.common_name is not null and lower(extensions.unaccent(pc.common_name)) like '%' || escaped.q_escaped || '%' escape '\')
        or (pc.cultivar_name is not null and lower(extensions.unaccent(pc.cultivar_name)) like '%' || escaped.q_escaped || '%' escape '\')
        or exists (
          select 1 from public.plant_taxon_names ptn
          where ptn.taxon_id = pc.taxon_id
            and lower(extensions.unaccent(ptn.name)) like '%' || escaped.q_escaped || '%' escape '\'
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
  'Plant Finder search: published plant_catalog rows matched by display_name/common_name/cultivar_name or any plant_taxon_names synonym for the same taxon, case- and accent-insensitive. Returns {total, rows} in one round trip. See lib/plantFinderApi.js.';

revoke all on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer) from public;
grant execute on function public.search_published_plants(text, text, text[], numeric, numeric, integer, integer) to anon, authenticated;
