-- AI Chat V1 general-mode context (resolveGeneralContext, lib/chatContext.js)
-- reads these four tables via the service-role client, scoped explicitly to
-- the verified caller's user id. service_role had no SELECT grant on any of
-- them (RLS is bypassed by service_role entirely, but table privileges are
-- not — the same reason plant_photos needed its own read grant for account
-- deletion, see 20260922104939). This only adds the read access that read
-- path needs; it changes no RLS policy and no privilege for anon/authenticated.

grant select on table public.plants to service_role;
grant select on table public.garden_zones to service_role;
grant select on table public.plant_reminders to service_role;
grant select on table public.profiles to service_role;
