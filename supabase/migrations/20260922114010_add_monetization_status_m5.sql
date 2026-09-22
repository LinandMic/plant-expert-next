-- ALMEO Monetization Foundation M5
-- Read-only, authenticated status used by the UI. The effective AI-credit
-- count includes the single non-cumulative Free monthly credit once it is
-- eligible, even before that credit is lazily materialized by consumption.

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
    'tier', v_entitlement.tier,
    'billing_period', v_entitlement.billing_period,
    'subscription_status', v_entitlement.subscription_status,
    'partner_offers_enabled', v_entitlement.partner_offers_enabled,
    'included_credits', v_balance.included_credits,
    'purchased_credits', v_balance.purchased_credits,
    'free_monthly_available', v_free_monthly_available,
    'available_credits',
      v_balance.included_credits
      + v_balance.purchased_credits
      + case when v_free_monthly_available then 1 else 0 end,
    'garden_plant_count', v_garden_count,
    'garden_plant_limit', case when v_entitlement.tier = 'free' then 10 else null end,
    'reminder_plant_count', v_reminder_plant_count,
    'reminder_plant_limit', case when v_entitlement.tier = 'free' then 3 else null end
  );
end;
$$;

revoke all on function public.get_monetization_status() from public;
revoke all on function public.get_monetization_status() from anon;
revoke all on function public.get_monetization_status() from authenticated;
grant execute on function public.get_monetization_status() to authenticated;
