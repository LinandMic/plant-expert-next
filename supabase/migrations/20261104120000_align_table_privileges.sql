-- Align table privileges with production, then harden anon/authenticated.
--
-- Part 1 — no effect in production. Production's default privileges give
-- service_role and anon only what the migrations grant explicitly, while a
-- database rebuilt from the migrations (local/CI) still gets Supabase's
-- broader defaults. These revokes remove, locally, exactly the privileges
-- production does not have; in production they are no-ops.

revoke insert, update, delete on table
  public.user_entitlements,
  public.profiles,
  public.plants,
  public.plant_photos,
  public.plant_reminders,
  public.garden_zones
from service_role;

revoke select, update, delete on table public.ai_analysis_usage from service_role;
revoke delete on table public.ai_chat_sessions from service_role;
revoke update, delete on table public.ai_chat_usage, public.ai_credit_ledger from service_role;
revoke insert, delete on table public.ai_credit_balances from service_role;

revoke select, insert, update, delete on table public.plants, public.plant_photos from anon;

-- Part 2 — hardening, applies to production too. anon and authenticated
-- never need TRUNCATE (not covered by RLS), REFERENCES, TRIGGER or MAINTAIN
-- (Postgres 17): no app code, API route or RPC function uses them.

revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
