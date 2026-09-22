-- ALMEO Monetization Foundation M1
-- Adds provider-agnostic entitlements and AI credit accounting.
-- No paywall, store billing, ads, garden limits, reminder limits, or Anthropic flow changes in this migration.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free',
  billing_period text,
  subscription_status text not null default 'inactive',
  current_period_start_at timestamptz,
  current_period_end_at timestamptz,
  partner_offers_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_entitlements_tier_check
    check (tier in ('free', 'premium')),
  constraint user_entitlements_billing_period_check
    check (billing_period is null or billing_period in ('monthly', 'annual')),
  constraint user_entitlements_subscription_status_check
    check (subscription_status in ('inactive', 'active', 'grace_period', 'past_due', 'canceled', 'expired'))
);

create table if not exists public.ai_credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  included_credits integer not null default 0,
  purchased_credits integer not null default 0,
  welcome_exhausted_at timestamptz,
  last_free_monthly_grant_at timestamptz,
  last_premium_monthly_grant_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_credit_balances_included_nonnegative check (included_credits >= 0),
  constraint ai_credit_balances_purchased_nonnegative check (purchased_credits >= 0)
);

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  included_delta integer not null default 0,
  purchased_delta integer not null default 0,
  reason text not null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_credit_ledger_nonzero_delta_check
    check (included_delta <> 0 or purchased_delta <> 0),
  constraint ai_credit_ledger_reason_check
    check (reason in (
      'free_welcome',
      'free_monthly',
      'premium_activation',
      'premium_monthly',
      'analysis_consumed',
      'credit_pack_purchase',
      'admin_adjustment'
    )),
  constraint ai_credit_ledger_user_idempotency_unique
    unique (user_id, idempotency_key)
);

create index if not exists ai_credit_ledger_user_created_at_idx
  on public.ai_credit_ledger(user_id, created_at desc);

drop trigger if exists set_user_entitlements_updated_at on public.user_entitlements;
create trigger set_user_entitlements_updated_at
before update on public.user_entitlements
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_credit_balances_updated_at on public.ai_credit_balances;
create trigger set_ai_credit_balances_updated_at
before update on public.ai_credit_balances
for each row execute function public.set_updated_at();

create or replace function public.prevent_ai_credit_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_credit_ledger is append-only';
end;
$$;

drop trigger if exists prevent_ai_credit_ledger_update on public.ai_credit_ledger;
create trigger prevent_ai_credit_ledger_update
before update on public.ai_credit_ledger
for each row execute function public.prevent_ai_credit_ledger_mutation();

drop trigger if exists prevent_ai_credit_ledger_delete on public.ai_credit_ledger;
create trigger prevent_ai_credit_ledger_delete
before delete on public.ai_credit_ledger
for each row execute function public.prevent_ai_credit_ledger_mutation();

alter table public.user_entitlements enable row level security;
alter table public.ai_credit_balances enable row level security;
alter table public.ai_credit_ledger enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own
on public.user_entitlements
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ai_credit_balances_select_own on public.ai_credit_balances;
create policy ai_credit_balances_select_own
on public.ai_credit_balances
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ai_credit_ledger_select_own on public.ai_credit_ledger;
create policy ai_credit_ledger_select_own
on public.ai_credit_ledger
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_entitlements from anon, authenticated;
revoke all on table public.ai_credit_balances from anon, authenticated;
revoke all on table public.ai_credit_ledger from anon, authenticated;

grant select on table public.user_entitlements to authenticated;
grant select on table public.ai_credit_balances to authenticated;

revoke all on function public.prevent_ai_credit_ledger_mutation() from public;
revoke all on function public.prevent_ai_credit_ledger_mutation() from anon;
revoke all on function public.prevent_ai_credit_ledger_mutation() from authenticated;

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

  insert into public.user_entitlements (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.ai_credit_balances (user_id, included_credits, purchased_credits)
  values (new.id, 5, 0)
  on conflict (user_id) do nothing;

  insert into public.ai_credit_ledger (
    user_id,
    included_delta,
    purchased_delta,
    reason,
    idempotency_key,
    metadata
  )
  values (
    new.id,
    5,
    0,
    'free_welcome',
    'free_welcome',
    '{"source":"account_creation"}'::jsonb
  )
  on conflict (user_id, idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- Backfill existing accounts. ON CONFLICT makes this safe to re-run without
-- granting a second welcome allocation or creating duplicate ledger rows.
insert into public.user_entitlements (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

insert into public.ai_credit_balances (user_id, included_credits, purchased_credits)
select id, 5, 0
from auth.users
on conflict (user_id) do nothing;

insert into public.ai_credit_ledger (
  user_id,
  included_delta,
  purchased_delta,
  reason,
  idempotency_key,
  metadata
)
select
  id,
  5,
  0,
  'free_welcome',
  'free_welcome',
  '{"source":"m1_backfill"}'::jsonb
from auth.users
on conflict (user_id, idempotency_key) do nothing;
