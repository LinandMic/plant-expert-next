-- ALMEO Monetization M7
-- The Free garden (M3) and reminder-plant (M4) limits, and the limits and
-- tier reported by get_monetization_status (M5), now follow effective
-- Premium (M6) instead of tier alone: an expired, past_due or never-dated
-- Premium entitlement is limited like a Free account.
--
-- Everything else is unchanged: same signatures, same row lock, same limits,
-- nothing is ever deleted on downgrade. The Free monthly credit
-- (free_monthly_available here, consume_ai_credit in M2) still looks at tier
-- and is moved to effective Premium in M8.

create or replace function public.enforce_free_garden_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_status text;
  v_period_end timestamptz;
  v_count integer;
  v_auth_uid uuid := auth.uid();
begin
  -- Never inspect another user's monetization state for a normal
  -- authenticated client. Let the existing plants RLS reject that write.
  if v_auth_uid is not null and v_auth_uid <> new.user_id then
    return new;
  end if;

  -- Serialize concurrent inserts for the same user before counting. This
  -- prevents two simultaneous 10th/11th inserts from both passing.
  select tier, subscription_status, current_period_end_at
  into v_tier, v_status, v_period_end
  from public.user_entitlements
  where user_id = new.user_id
  for update;

  if not found then
    raise exception 'MONETIZATION_STATE_MISSING'
      using errcode = 'P0001';
  end if;

  if public.is_premium_effective(v_tier, v_status, v_period_end, now()) then
    return new;
  end if;

  select count(*)::integer
  into v_count
  from public.plants
  where user_id = new.user_id;

  if v_count >= 10 then
    raise exception 'FREE_GARDEN_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_free_reminder_plant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_status text;
  v_period_end timestamptz;
  v_auth_uid uuid := auth.uid();
  v_current_count integer;
  v_prospective_count integer;
begin
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and new.plant_id = old.plant_id then
    return new;
  end if;

  if v_auth_uid is not null and v_auth_uid <> new.user_id then
    return new;
  end if;

  select tier, subscription_status, current_period_end_at
  into v_tier, v_status, v_period_end
  from public.user_entitlements
  where user_id = new.user_id
  for update;

  if not found then
    raise exception 'MONETIZATION_STATE_MISSING'
      using errcode = 'P0001';
  end if;

  if public.is_premium_effective(v_tier, v_status, v_period_end, now()) then
    return new;
  end if;

  select count(distinct plant_id)::integer
  into v_current_count
  from public.plant_reminders
  where user_id = new.user_id;

  if tg_op = 'INSERT' then
    select count(distinct plant_id)::integer
    into v_prospective_count
    from (
      select plant_id
      from public.plant_reminders
      where user_id = new.user_id
      union all
      select new.plant_id
    ) s;
  else
    select count(distinct plant_id)::integer
    into v_prospective_count
    from (
      select plant_id
      from public.plant_reminders
      where user_id = new.user_id
        and id <> old.id
      union all
      select new.plant_id
    ) s;
  end if;

  if v_prospective_count > greatest(v_current_count, 3) then
    raise exception 'FREE_REMINDER_PLANT_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- tier is now the effective tier; current_period_end_at is exposed so the UI
-- can show until when a canceled but paid subscription stays Premium.
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

  v_free_monthly_available :=
    v_entitlement.tier = 'free'
    and v_balance.included_credits = 0
    and v_balance.welcome_exhausted_at is not null
    and now() >= (
      coalesce(v_balance.last_free_monthly_grant_at, v_balance.welcome_exhausted_at)
      + interval '1 month'
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
