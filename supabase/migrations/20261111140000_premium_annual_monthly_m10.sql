-- ALMEO Monetization M10
-- Monthly 25 credits of the annual Premium plan, computed on use (no
-- scheduled job) and shown in the status (decision 9). The monthly plan
-- already gets its 25 at each renewal through grant_premium_period (M9).
--
-- Rule (premium_monthly_due, shared by consume_ai_credit and
-- get_monetization_status so they never disagree): for an effective
-- Premium annual entitlement with last_premium_monthly_grant_at set, month
-- k is due at last_premium_monthly_grant_at + k months (k >= 1, computed in
-- UTC from that date, not chained) once that date is reached. Every due
-- month is granted at once (catch-up), month by month, each capped so that
-- included_credits never exceeds 50 through a grant (decision 8); the start
-- date then moves to the last due month, so months lost to the cap are
-- never granted later. Unlike the Free monthly credit, these credits are
-- stored in included_credits.
--
-- consume_ai_credit grants the due months before consuming, with one
-- premium_monthly ledger row per month granted more than 0
-- (premium_annual_month:<due date UTC>). An analysis paid with such a
-- credit is refunded like any included credit (refund_ai_credit unchanged).
--
-- A Premium annual entitlement set by hand must go through
-- grant_premium_period: without last_premium_monthly_grant_at no month is
-- ever granted.

create or replace function public.premium_monthly_due(
  p_tier text,
  p_status text,
  p_period_end timestamptz,
  p_billing_period text,
  p_last_premium_monthly_grant_at timestamptz,
  p_included_credits integer,
  p_at timestamptz,
  out months_due integer,
  out credits_due integer,
  out through_at timestamptz,
  out next_at timestamptz
)
language sql
immutable
set search_path = ''
as $$
  select
    case when e.eligible then d.n else 0 end,
    case when e.eligible and d.n > 0
      then least(25 * d.n, greatest(0, 50 - p_included_credits))
      else 0
    end,
    case when e.eligible and d.n > 0
      then ((p_last_premium_monthly_grant_at at time zone 'UTC') + make_interval(months => d.n)) at time zone 'UTC'
    end,
    case
      when not e.eligible then null
      when p_status = 'canceled'
        and ((p_last_premium_monthly_grant_at at time zone 'UTC') + make_interval(months => d.n + 1)) at time zone 'UTC' >= p_period_end
        then null
      else ((p_last_premium_monthly_grant_at at time zone 'UTC') + make_interval(months => d.n + 1)) at time zone 'UTC'
    end
  from (
    select coalesce(
      public.is_premium_effective(p_tier, p_status, p_period_end, p_at)
      and p_billing_period = 'annual'
      and p_last_premium_monthly_grant_at is not null,
      false
    ) as eligible
  ) e
  cross join lateral (
    select count(*)::integer as n
    from generate_series(1, 240) as k
    where ((p_last_premium_monthly_grant_at at time zone 'UTC') + make_interval(months => k)) at time zone 'UTC' <= p_at
  ) d;
$$;

comment on function public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz) is
  'Monthly 25 credits of the annual Premium plan due at p_at: for an effective Premium annual entitlement, month k is due at last_premium_monthly_grant_at + k months (UTC). Returns months_due, credits_due (25 per month, capped so included credits never exceed 50 through a grant), through_at (the last due month, new start date) and next_at (next month date; null when not applicable, or when a canceled subscription ends before it). Shared by consume_ai_credit and get_monetization_status.';

revoke all on function public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz) from public;
revoke all on function public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz) from anon;
grant execute on function public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz) to authenticated, service_role;

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
  v_billing_period text;
  v_now timestamptz := now();
  v_consume_key text;
  v_existing_source text;
  v_source text;
  v_welcome_exhausted_now boolean := false;
  v_included_for_cap integer;
  v_months_due integer;
  v_credits_due integer;
  v_through_at timestamptz;
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

  select tier, subscription_status, current_period_end_at, billing_period
  into v_tier, v_status, v_period_end, v_billing_period
  from public.user_entitlements
  where user_id = target_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  -- Grant the monthly credits of the annual plan due so far, before
  -- consuming: those months started before this analysis.
  v_included_for_cap := v_balance.included_credits;

  select d.months_due, d.credits_due, d.through_at
  into v_months_due, v_credits_due, v_through_at
  from public.premium_monthly_due(
    v_tier,
    v_status,
    v_period_end,
    v_billing_period,
    v_balance.last_premium_monthly_grant_at,
    v_included_for_cap,
    v_now
  ) d;

  if v_months_due > 0 then
    insert into public.ai_credit_ledger (
      user_id,
      included_delta,
      purchased_delta,
      reason,
      idempotency_key,
      metadata
    )
    select
      target_user_id,
      m.granted,
      0,
      'premium_monthly',
      'premium_annual_month:' || to_char(m.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      jsonb_build_object(
        'due_at', m.due_at,
        'month_index', m.k,
        'credits_planned', 25,
        'credits_granted', m.granted,
        'capped', m.granted < 25
      )
    from (
      select
        k,
        ((v_balance.last_premium_monthly_grant_at at time zone 'UTC') + make_interval(months => k)) at time zone 'UTC' as due_at,
        least(25, greatest(0, 50 - v_included_for_cap - 25 * (k - 1))) as granted
      from generate_series(1, v_months_due) as k
    ) m
    where m.granted > 0;

    update public.ai_credit_balances
    set
      included_credits = included_credits + v_credits_due,
      last_premium_monthly_grant_at = v_through_at
    where user_id = target_user_id
    returning * into v_balance;
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
  v_premium_monthly_due integer := 0;
  v_next_premium_monthly_at timestamptz;
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

  -- What the next consumption would grant, without writing (stable).
  select d.credits_due, d.next_at
  into v_premium_monthly_due, v_next_premium_monthly_at
  from public.premium_monthly_due(
    v_entitlement.tier,
    v_entitlement.subscription_status,
    v_entitlement.current_period_end_at,
    v_entitlement.billing_period,
    v_balance.last_premium_monthly_grant_at,
    v_balance.included_credits,
    now()
  ) d;

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
    'premium_monthly_due', v_premium_monthly_due,
    'next_premium_monthly_at', v_next_premium_monthly_at,
    'available_credits',
      v_balance.included_credits
      + v_premium_monthly_due
      + v_balance.purchased_credits
      + case when v_free_monthly_available then 1 else 0 end,
    'garden_plant_count', v_garden_count,
    'garden_plant_limit', case when v_is_premium then null else 10 end,
    'reminder_plant_count', v_reminder_plant_count,
    'reminder_plant_limit', case when v_is_premium then null else 3 end
  );
end;
$$;
