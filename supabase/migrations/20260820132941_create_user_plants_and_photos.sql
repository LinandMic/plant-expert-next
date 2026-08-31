create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  common_name text,
  latin_name text,
  family text,
  category text,
  plantation text,
  usage text,
  description text,
  confidence text,
  ai_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plants_id_user_id_unique unique (id, user_id)
);

create table if not exists public.plant_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null,
  storage_path text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint plant_photos_plant_owner_fk
    foreign key (plant_id, user_id)
    references public.plants(id, user_id)
    on delete cascade,
  constraint plant_photos_storage_path_unique unique (storage_path)
);

create index if not exists plants_user_id_idx on public.plants(user_id);
create index if not exists plants_user_created_at_idx on public.plants(user_id, created_at desc);
create index if not exists plant_photos_user_id_idx on public.plant_photos(user_id);
create index if not exists plant_photos_plant_id_idx on public.plant_photos(plant_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_plants_updated_at on public.plants;
create trigger set_plants_updated_at
before update on public.plants
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.plants enable row level security;
alter table public.plant_photos enable row level security;

-- Profiles: users can read and update only their own profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Plants: full CRUD, strictly scoped to the authenticated user.
drop policy if exists plants_select_own on public.plants;
create policy plants_select_own
on public.plants
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists plants_insert_own on public.plants;
create policy plants_insert_own
on public.plants
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists plants_update_own on public.plants;
create policy plants_update_own
on public.plants
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists plants_delete_own on public.plants;
create policy plants_delete_own
on public.plants
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Plant photos metadata: full CRUD, strictly scoped to the authenticated user.
drop policy if exists plant_photos_select_own on public.plant_photos;
create policy plant_photos_select_own
on public.plant_photos
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists plant_photos_insert_own on public.plant_photos;
create policy plant_photos_insert_own
on public.plant_photos
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists plant_photos_update_own on public.plant_photos;
create policy plant_photos_update_own
on public.plant_photos
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists plant_photos_delete_own on public.plant_photos;
create policy plant_photos_delete_own
on public.plant_photos
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Private bucket for plant photos. Files must be stored under <user-uuid>/... paths.
insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists plant_photos_storage_select_own on storage.objects;
create policy plant_photos_storage_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists plant_photos_storage_insert_own on storage.objects;
create policy plant_photos_storage_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists plant_photos_storage_update_own on storage.objects;
create policy plant_photos_storage_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists plant_photos_storage_delete_own on storage.objects;
create policy plant_photos_storage_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);;
