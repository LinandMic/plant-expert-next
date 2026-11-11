-- ALMEO Monetization M9
-- grant_premium_period: records a paid Premium period and grants its AI
-- credits. Called later by the Billing server (service_role) only.
--
-- Credits (decisions 3, 4, 8):
--   first activation of the account   monthly 25, annual 50  (premium_activation)
--   re-subscription after an end      25, any plan          (premium_activation, kind reactivation)
--   monthly renewal                   25                    (premium_monthly)
--   annual renewal                    0, the monthly 25 of the annual plan comes from M10
-- A renewal is a new period of a Premium entitlement that is not expired and
-- starts no later than the current period end; anything else after the
-- first activation is a re-subscription. Grants are capped so that
-- included_credits never exceeds 50 through a grant; purchased credits are
-- neither counted nor capped, and refunds are not capped.
--
-- Idempotency: one premium_period_grants row per (user_id, grant_key), even
-- when the cap leaves nothing to grant. A period ending no later than the
-- current one is refused (STALE_PERIOD) so that out-of-order calls never
-- move the dates back or grant twice.
--
-- SECURITY DEFINER: service_role keeps no write privilege on
-- user_entitlements (removed on purpose in 20261104120000) nor on
-- premium_period_grants; writes go through this function only.

create table public.premium_period_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_key text not null,
  kind text not null,
  billing_period text not null,
  period_start_at timestamptz not null,
  period_end_at timestamptz not null,
  credits_planned integer not null,
  credits_granted integer not null,
  capped boolean not null,
  created_at timestamptz not null default now(),
  constraint premium_period_grants_user_key_unique unique (user_id, grant_key),
  constraint premium_period_grants_kind_check
    check (kind in ('activation', 'reactivation', 'renewal')),
  constraint premium_period_grants_billing_period_check
    check (billing_period in ('monthly', 'annual')),
  constraint premium_period_grants_period_check
    check (period_end_at > period_start_at),
  constraint premium_period_grants_credits_check
    check (credits_granted >= 0 and credits_granted <= credits_planned)
);

alter table public.premium_period_grants enable row level security;

revoke all on table public.premium_period_grants from anon, authenticated, service_role;
grant select on table public.premium_period_grants to service_role;

create or replace function public.grant_premium_period(
  target_user_id uuid,
  p_grant_key text,
  p_billing_period text,
  p_period_start_at timestamptz,
  p_period_end_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement public.user_entitlements%rowtype;
  v_balance public.ai_credit_balances%rowtype;
  v_existing public.premium_period_grants%rowtype;
  v_has_activation boolean;
  v_kind text;
  v_planned integer;
  v_granted integer;
  v_capped boolean;
begin
  if target_user_id is null or p_grant_key is null or btrim(p_grant_key) = '' then
    raise exception 'grant_premium_period: target_user_id and grant_key are required';
  end if;

  if p_billing_period is null or p_billing_period not in ('monthly', 'annual') then
    raise exception 'grant_premium_period: billing_period must be monthly or annual';
  end if;

  if p_period_start_at is null or p_period_end_at is null or p_period_end_at <= p_period_start_at then
    raise exception 'grant_premium_period: period_end_at must be after period_start_at';
  end if;

  select *
  into v_entitlement
  from public.user_entitlements
  where user_id = target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  select *
  into v_balance
  from public.ai_credit_balances
  where user_id = target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  -- Replay of an already processed period: return what was recorded.
  select *
  into v_existing
  from public.premium_period_grants
  where user_id = target_user_id
    and grant_key = p_grant_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_granted', true,
      'kind', v_existing.kind,
      'credits_granted', v_existing.credits_granted,
      'capped', v_existing.capped,
      'included_credits', v_balance.included_credits,
      'purchased_credits', v_balance.purchased_credits,
      'current_period_end_at', v_entitlement.current_period_end_at
    );
  end if;

  if v_entitlement.tier = 'premium'
     and v_entitlement.current_period_end_at is not null
     and p_period_end_at <= v_entitlement.current_period_end_at then
    return jsonb_build_object('ok', false, 'code', 'STALE_PERIOD');
  end if;

  v_has_activation := exists (
    select 1
    from public.premium_period_grants
    where user_id = target_user_id
      and kind = 'activation'
  );

  if not v_has_activation then
    v_kind := 'activation';
    v_planned := case when p_billing_period = 'annual' then 50 else 25 end;
  elsif v_entitlement.tier = 'premium'
     and v_entitlement.subscription_status <> 'expired'
     and v_entitlement.current_period_end_at is not null
     and p_period_start_at <= v_entitlement.current_period_end_at then
    v_kind := 'renewal';
    v_planned := case when p_billing_period = 'annual' then 0 else 25 end;
  else
    v_kind := 'reactivation';
    v_planned := 25;
  end if;

  v_granted := least(v_planned, greatest(0, 50 - v_balance.included_credits));
  v_capped := v_granted < v_planned;

  update public.user_entitlements
  set
    tier = 'premium',
    billing_period = p_billing_period,
    subscription_status = 'active',
    current_period_start_at = p_period_start_at,
    current_period_end_at = p_period_end_at
  where user_id = target_user_id
  returning * into v_entitlement;

  -- An annual renewal grants nothing here: its monthly credit is counted
  -- from the previous monthly grant (M10), so that date is left as is.
  update public.ai_credit_balances
  set
    included_credits = included_credits + v_granted,
    last_premium_monthly_grant_at = case
      when v_kind = 'renewal' and p_billing_period = 'annual' then last_premium_monthly_grant_at
      else p_period_start_at
    end
  where user_id = target_user_id
  returning * into v_balance;

  if v_granted > 0 then
    insert into public.ai_credit_ledger (
      user_id,
      included_delta,
      purchased_delta,
      reason,
      idempotency_key,
      metadata
    )
    values (
      target_user_id,
      v_granted,
      0,
      case when v_kind = 'renewal' then 'premium_monthly' else 'premium_activation' end,
      'premium_grant:' || p_grant_key,
      jsonb_build_object(
        'grant_key', p_grant_key,
        'kind', v_kind,
        'billing_period', p_billing_period,
        'period_start_at', p_period_start_at,
        'period_end_at', p_period_end_at,
        'credits_planned', v_planned,
        'credits_granted', v_granted,
        'capped', v_capped
      )
    );
  end if;

  insert into public.premium_period_grants (
    user_id,
    grant_key,
    kind,
    billing_period,
    period_start_at,
    period_end_at,
    credits_planned,
    credits_granted,
    capped
  )
  values (
    target_user_id,
    p_grant_key,
    v_kind,
    p_billing_period,
    p_period_start_at,
    p_period_end_at,
    v_planned,
    v_granted,
    v_capped
  );

  return jsonb_build_object(
    'ok', true,
    'already_granted', false,
    'kind', v_kind,
    'credits_granted', v_granted,
    'capped', v_capped,
    'included_credits', v_balance.included_credits,
    'purchased_credits', v_balance.purchased_credits,
    'current_period_end_at', v_entitlement.current_period_end_at
  );
end;
$$;

comment on function public.grant_premium_period(uuid, text, text, timestamptz, timestamptz) is
  'Records a paid Premium period (tier premium, status active, billing_period, period dates) and grants its AI credits: first activation of the account 25 (monthly) or 50 (annual), re-subscription 25, monthly renewal 25, annual renewal 0 (monthly credit from M10). Grants are capped so included_credits never exceeds 50 through a grant; purchased credits are not counted. Idempotent on (user_id, grant_key) through premium_period_grants; a period ending no later than the current one returns STALE_PERIOD. SECURITY DEFINER, service_role only.';

revoke all on function public.grant_premium_period(uuid, text, text, timestamptz, timestamptz) from public;
revoke all on function public.grant_premium_period(uuid, text, text, timestamptz, timestamptz) from anon;
revoke all on function public.grant_premium_period(uuid, text, text, timestamptz, timestamptz) from authenticated;
grant execute on function public.grant_premium_period(uuid, text, text, timestamptz, timestamptz) to service_role;
