-- ALMEO Monetization Foundation M2
-- Secures atomic AI-credit consumption/refund and adds server-side AI usage metering.

alter table public.ai_credit_ledger
  drop constraint if exists ai_credit_ledger_reason_check;

alter table public.ai_credit_ledger
  add constraint ai_credit_ledger_reason_check
  check (reason in (
    'free_welcome',
    'free_monthly',
    'premium_activation',
    'premium_monthly',
    'analysis_consumed',
    'analysis_refunded',
    'credit_pack_purchase',
    'admin_adjustment'
  ));

create table if not exists public.ai_analysis_usage (
  request_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  status text not null,
  credit_source text,
  upstream_status integer,
  input_tokens integer,
  output_tokens integer,
  cache_creation_input_tokens integer,
  cache_read_input_tokens integer,
  created_at timestamptz not null default now(),
  constraint ai_analysis_usage_status_check
    check (status in ('succeeded', 'refunded', 'refund_failed')),
  constraint ai_analysis_usage_credit_source_check
    check (credit_source is null or credit_source in ('included', 'purchased')),
  constraint ai_analysis_usage_input_tokens_nonnegative
    check (input_tokens is null or input_tokens >= 0),
  constraint ai_analysis_usage_output_tokens_nonnegative
    check (output_tokens is null or output_tokens >= 0),
  constraint ai_analysis_usage_cache_creation_nonnegative
    check (cache_creation_input_tokens is null or cache_creation_input_tokens >= 0),
  constraint ai_analysis_usage_cache_read_nonnegative
    check (cache_read_input_tokens is null or cache_read_input_tokens >= 0)
);

create index if not exists ai_analysis_usage_user_created_at_idx
  on public.ai_analysis_usage(user_id, created_at desc);

alter table public.ai_analysis_usage enable row level security;

drop policy if exists ai_analysis_usage_select_own on public.ai_analysis_usage;
create policy ai_analysis_usage_select_own
on public.ai_analysis_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.ai_analysis_usage from anon, authenticated;

create or replace function public.consume_ai_credit(target_user_id uuid, request_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_balance public.ai_credit_balances%rowtype;
  v_tier text;
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

  select tier
  into v_tier
  from public.user_entitlements
  where user_id = target_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'MONETIZATION_STATE_MISSING');
  end if;

  if v_balance.included_credits > 0 then
    v_source := 'included';
    v_welcome_exhausted_now :=
      v_tier = 'free'
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

  elsif v_tier = 'free'
    and v_balance.welcome_exhausted_at is not null
    and v_now >= (
      coalesce(v_balance.last_free_monthly_grant_at, v_balance.welcome_exhausted_at)
      + interval '1 month'
    )
  then
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
      jsonb_build_object('request_id', request_key)
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

revoke all on function public.consume_ai_credit(uuid, text) from public;
revoke all on function public.consume_ai_credit(uuid, text) from anon;
revoke all on function public.consume_ai_credit(uuid, text) from authenticated;
grant execute on function public.consume_ai_credit(uuid, text) to service_role;

revoke all on function public.refund_ai_credit(uuid, text) from public;
revoke all on function public.refund_ai_credit(uuid, text) from anon;
revoke all on function public.refund_ai_credit(uuid, text) from authenticated;
grant execute on function public.refund_ai_credit(uuid, text) to service_role;
