-- ALMEO Monetization M8
-- The Free monthly credit follows effective Premium (M6) instead of tier,
-- resumes one month after the end of a Premium period, and is no longer
-- turned into a stored credit when the analysis that used it is refunded.
--
-- Rule (free_monthly_due, shared by consume_ai_credit and
-- get_monetization_status so they never disagree): no effective Premium,
-- no included credit left, and one month elapsed since the latest of the
-- last Free monthly grant, the end of the welcome credits and the end of
-- the last Premium period. An account that was Premium before using up its
-- welcome credits therefore gets the monthly credit back one month after
-- its period ends. current_period_end_at must be kept when Premium ends.
--
-- Refunding an analysis paid by the Free monthly credit leaves
-- included_credits unchanged and restores last_free_monthly_grant_at to its
-- value before that grant (the credit is available again, never stored). If
-- another monthly grant happened since, nothing is restored. In both cases
-- the ledger gets analysis_refunded +1 and free_monthly -1, so its sum
-- stays equal to the balance.

create or replace function public.free_monthly_due(
  p_tier text,
  p_status text,
  p_period_end timestamptz,
  p_included_credits integer,
  p_welcome_exhausted_at timestamptz,
  p_last_free_monthly_grant_at timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    not public.is_premium_effective(p_tier, p_status, p_period_end, p_at)
    and p_included_credits = 0
    and p_at >= greatest(p_last_free_monthly_grant_at, p_welcome_exhausted_at, p_period_end) + interval '1 month',
    false
  );
$$;

comment on function public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz) is
  'Free monthly credit due at p_at: no effective Premium (is_premium_effective), no included credit left, and p_at >= greatest(last Free monthly grant, end of welcome credits, end of the last Premium period) + 1 month. The Free monthly credit resumes one month after current_period_end_at (decision 2), also for an account that never used up its welcome credits. Shared by consume_ai_credit and get_monetization_status.';

revoke all on function public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.consume_ai_credit(target_user_id uuid, request_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_balance public.ai_credit_balances%rowtype;
  v_tier text;
  v_status text;
  v_period_end timestamptz;
  v_now timestamptz := now();
  v_consume_key text;
  v_existing_source text;
  v_source text;
  v_welcome_exhausted_now boolean := false;
begin
  if target_user_id is null or request_key is null or btrim(request_key) = '' then
    raise exception 'consume_ai_credit: target_user_id and request_key are required';
  end if;

  v_consume_key := 'analysis_consume:' || request_key;

  select *
  into v_balance
  from public.ai_credit_balances
  where user_id = target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  select metadata ->> 'credit_source'
  into v_existing_source
  from public.ai_credit_ledger
  where user_id = target_user_id
    and idempotency_key = v_consume_key
    and reason = 'analysis_consumed'
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_consumed', true,
      'credit_source', v_existing_source,
      'included_credits', v_balance.included_credits,
      'purchased_credits', v_balance.purchased_credits
    );
  end if;

  select tier, subscription_status, current_period_end_at
  into v_tier, v_status, v_period_end
  from public.user_entitlements
  where user_id = target_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  if v_balance.included_credits > 0 then
    v_source := 'included';
    v_welcome_exhausted_now :=
      not public.is_premium_effective(v_tier, v_status, v_period_end, v_now)
      and v_balance.included_credits = 1
      and v_balance.welcome_exhausted_at is null;

    update public.ai_credit_balances
    set
      included_credits = included_credits - 1,
      welcome_exhausted_at = case
        when v_welcome_exhausted_now then v_now
        else welcome_exhausted_at
      end
    where user_id = target_user_id
    returning * into v_balance;

  elsif public.free_monthly_due(
    v_tier,
    v_status,
    v_period_end,
    v_balance.included_credits,
    v_balance.welcome_exhausted_at,
    v_balance.last_free_monthly_grant_at,
    v_now
  ) then
    v_source := 'included';

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
      1,
      0,
      'free_monthly',
      'free_monthly:' || request_key,
      jsonb_build_object(
        'request_id', request_key,
        'previous_grant_at', v_balance.last_free_monthly_grant_at
      )
    )
    on conflict (user_id, idempotency_key) do nothing;

    update public.ai_credit_balances
    set last_free_monthly_grant_at = v_now
    where user_id = target_user_id
    returning * into v_balance;

  elsif v_balance.purchased_credits > 0 then
    v_source := 'purchased';

    update public.ai_credit_balances
    set purchased_credits = purchased_credits - 1
    where user_id = target_user_id
    returning * into v_balance;

  else
    return jsonb_build_object(
      'ok', false,
      'code', 'NO_CREDITS',
      'included_credits', v_balance.included_credits,
      'purchased_credits', v_balance.purchased_credits
    );
  end if;

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
    case when v_source = 'included' then -1 else 0 end,
    case when v_source = 'purchased' then -1 else 0 end,
    'analysis_consumed',
    v_consume_key,
    jsonb_build_object(
      'request_id', request_key,
      'credit_source', v_source,
      'welcome_exhausted_now', v_welcome_exhausted_now
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_consumed', false,
    'credit_source', v_source,
    'included_credits', v_balance.included_credits,
    'purchased_credits', v_balance.purchased_credits
  );
end;
$$;

create or replace function public.refund_ai_credit(target_user_id uuid, request_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_balance public.ai_credit_balances%rowtype;
  v_consume_key text;
  v_refund_key text;
  v_source text;
  v_welcome_exhausted_now boolean := false;
  v_free_monthly_granted_at timestamptz;
  v_previous_grant_at timestamptz;
  v_free_monthly_restored boolean := false;
begin
  if target_user_id is null or request_key is null or btrim(request_key) = '' then
    raise exception 'refund_ai_credit: target_user_id and request_key are required';
  end if;

  v_consume_key := 'analysis_consume:' || request_key;
  v_refund_key := 'analysis_refund:' || request_key;

  select *
  into v_balance
  from public.ai_credit_balances
  where user_id = target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  if exists (
    select 1
    from public.ai_credit_ledger
    where user_id = target_user_id
      and idempotency_key = v_refund_key
      and reason = 'analysis_refunded'
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'included_credits', v_balance.included_credits,
      'purchased_credits', v_balance.purchased_credits
    );
  end if;

  select
    metadata ->> 'credit_source',
    coalesce((metadata ->> 'welcome_exhausted_now')::boolean, false)
  into v_source, v_welcome_exhausted_now
  from public.ai_credit_ledger
  where user_id = target_user_id
    and idempotency_key = v_consume_key
    and reason = 'analysis_consumed'
  limit 1;

  if not found or v_source not in ('included', 'purchased') then
    return jsonb_build_object('ok', false, 'code', 'CONSUMPTION_NOT_FOUND');
  end if;

  -- Was this consumption paid by the Free monthly credit?
  select created_at, (metadata ->> 'previous_grant_at')::timestamptz
  into v_free_monthly_granted_at, v_previous_grant_at
  from public.ai_credit_ledger
  where user_id = target_user_id
    and idempotency_key = 'free_monthly:' || request_key
    and reason = 'free_monthly'
    and included_delta > 0
  limit 1;

  if found then
    -- Make the monthly credit available again instead of storing it, unless
    -- a later monthly grant already replaced this one.
    update public.ai_credit_balances
    set last_free_monthly_grant_at = v_previous_grant_at
    where user_id = target_user_id
      and last_free_monthly_grant_at = v_free_monthly_granted_at;
    v_free_monthly_restored := found;

    select *
    into v_balance
    from public.ai_credit_balances
    where user_id = target_user_id;

    insert into public.ai_credit_ledger (
      user_id,
      included_delta,
      purchased_delta,
      reason,
      idempotency_key,
      metadata
    )
    values
      (
        target_user_id,
        1,
        0,
        'analysis_refunded',
        v_refund_key,
        jsonb_build_object(
          'request_id', request_key,
          'credit_source', v_source,
          'free_monthly', true,
          'free_monthly_restored', v_free_monthly_restored
        )
      ),
      (
        target_user_id,
        -1,
        0,
        'free_monthly',
        'free_monthly_reversal:' || request_key,
        jsonb_build_object(
          'request_id', request_key,
          'free_monthly_restored', v_free_monthly_restored
        )
      );

    return jsonb_build_object(
      'ok', true,
      'already_refunded', false,
      'credit_source', v_source,
      'free_monthly', true,
      'free_monthly_restored', v_free_monthly_restored,
      'included_credits', v_balance.included_credits,
      'purchased_credits', v_balance.purchased_credits
    );
  end if;

  if v_source = 'included' then
    update public.ai_credit_balances
    set
      included_credits = included_credits + 1,
      welcome_exhausted_at = case
        when v_welcome_exhausted_now then null
        else welcome_exhausted_at
      end
    where user_id = target_user_id
    returning * into v_balance;
  else
    update public.ai_credit_balances
    set purchased_credits = purchased_credits + 1
    where user_id = target_user_id
    returning * into v_balance;
  end if;

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
    case when v_source = 'included' then 1 else 0 end,
    case when v_source = 'purchased' then 1 else 0 end,
    'analysis_refunded',
    v_refund_key,
    jsonb_build_object(
      'request_id', request_key,
      'credit_source', v_source
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'credit_source', v_source,
    'included_credits', v_balance.included_credits,
    'purchased_credits', v_balance.purchased_credits
  );
end;
$$;

create or replace function public.get_monetization_status()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entitlement public.user_entitlements%rowtype;
  v_balance public.ai_credit_balances%rowtype;
  v_is_premium boolean := false;
  v_free_monthly_available boolean := false;
  v_garden_count integer := 0;
  v_reminder_plant_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = 'P0001';
  end if;

  select *
  into v_entitlement
  from public.user_entitlements
  where user_id = v_user_id;

  select *
  into v_balance
  from public.ai_credit_balances
  where user_id = v_user_id;

  if v_entitlement.user_id is null or v_balance.user_id is null then
    raise exception 'MONETIZATION_STATE_MISSING'
      using errcode = 'P0001';
  end if;

  v_is_premium := public.is_premium_effective(
    v_entitlement.tier,
    v_entitlement.subscription_status,
    v_entitlement.current_period_end_at,
    now()
  );

  v_free_monthly_available := public.free_monthly_due(
    v_entitlement.tier,
    v_entitlement.subscription_status,
    v_entitlement.current_period_end_at,
    v_balance.included_credits,
    v_balance.welcome_exhausted_at,
    v_balance.last_free_monthly_grant_at,
    now()
  );

  select count(*)::integer
  into v_garden_count
  from public.plants
  where user_id = v_user_id;

  select count(distinct plant_id)::integer
  into v_reminder_plant_count
  from public.plant_reminders
  where user_id = v_user_id;

  return jsonb_build_object(
    'tier', case when v_is_premium then 'premium' else 'free' end,
    'billing_period', v_entitlement.billing_period,
    'subscription_status', v_entitlement.subscription_status,
    'current_period_end_at', v_entitlement.current_period_end_at,
    'partner_offers_enabled', v_entitlement.partner_offers_enabled,
    'included_credits', v_balance.included_credits,
    'purchased_credits', v_balance.purchased_credits,
    'free_monthly_available', v_free_monthly_available,
    'available_credits',
      v_balance.included_credits
      + v_balance.purchased_credits
      + case when v_free_monthly_available then 1 else 0 end,
    'garden_plant_count', v_garden_count,
    'garden_plant_limit', case when v_is_premium then null else 10 end,
    'reminder_plant_count', v_reminder_plant_count,
    'reminder_plant_limit', case when v_is_premium then null else 3 end
  );
end;
$$;
