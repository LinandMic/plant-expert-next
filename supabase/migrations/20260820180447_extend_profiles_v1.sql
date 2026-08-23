alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists space_type text;

revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.profiles from authenticated;

grant select, update on table public.profiles to authenticated;;
