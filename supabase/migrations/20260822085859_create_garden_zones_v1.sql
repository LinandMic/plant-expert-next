BEGIN;

create table public.garden_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  legacy_id text,
  name text not null,
  exposure text,
  orientation text,
  watering_mode text,
  watering_type text,
  watering_frequency_days integer,
  watering_duration_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint garden_zones_id_user_id_unique
    unique (id, user_id),

  constraint garden_zones_name_not_blank_check
    check (length(btrim(name)) > 0),

  constraint garden_zones_name_max_length_check
    check (length(name) <= 120),

  constraint garden_zones_exposure_check
    check (exposure is null or exposure in ('full_sun','partial_sun','bright_shade','shade','unknown')),

  constraint garden_zones_orientation_check
    check (orientation is null or orientation in ('n','ne','e','se','s','sw','w','nw','unknown')),

  constraint garden_zones_watering_mode_check
    check (watering_mode is null or watering_mode in ('manual','automatic')),

  constraint garden_zones_watering_type_check
    check (watering_type is null or watering_type in ('drip','micro_sprinkler','sprinkler','soaker_hose','other')),

  constraint garden_zones_watering_frequency_days_check
    check (watering_frequency_days is null or watering_frequency_days > 0),

  constraint garden_zones_watering_duration_minutes_check
    check (watering_duration_minutes is null or watering_duration_minutes > 0),

  constraint garden_zones_automatic_only_check
    check (
      coalesce(watering_mode, 'manual') = 'automatic'
      or (
        watering_type is null
        and watering_frequency_days is null
        and watering_duration_minutes is null
      )
    )
);

create index garden_zones_user_id_idx
  on public.garden_zones (user_id);

create unique index garden_zones_user_id_legacy_id_key
  on public.garden_zones (user_id, legacy_id)
  where legacy_id is not null;

create trigger set_garden_zones_updated_at
  before update on public.garden_zones
  for each row
  execute function public.set_updated_at();

alter table public.garden_zones enable row level security;

create policy "garden_zones_select_own"
  on public.garden_zones for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "garden_zones_insert_own"
  on public.garden_zones for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "garden_zones_update_own"
  on public.garden_zones for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "garden_zones_delete_own"
  on public.garden_zones for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.garden_zones to authenticated;
revoke all on public.garden_zones from anon;

alter table public.plants
  add column zone_id uuid;

alter table public.plants
  add constraint plants_zone_id_user_id_fkey
  foreign key (zone_id, user_id)
  references public.garden_zones (id, user_id)
  on delete set null (zone_id);

alter table public.plants
  drop constraint plants_manual_watering_fields_null_check;

alter table public.plants
  add constraint plants_manual_watering_fields_null_check
  check (
    coalesce(watering_mode, 'manual') = 'automatic'
    or (
      watering_type is null
      and watering_frequency_days is null
      and watering_duration_minutes is null
      and watering_flow_lph is null
      and watering_emitter_count is null
    )
  );

COMMIT;;
