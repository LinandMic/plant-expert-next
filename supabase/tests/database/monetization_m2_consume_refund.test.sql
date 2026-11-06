-- Tests for consume_ai_credit / refund_ai_credit (M2; Free monthly credit
-- rules from M8). Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- U: Free account. P: Premium account with no credits left.
select pg_temp.new_user('11111111-1111-1111-1111-111111111111');
select pg_temp.new_user('33333333-3333-3333-3333-333333333333');

create temp table r (step text primary key, res jsonb) on commit drop;

-- First consumption uses an included credit
insert into r values ('k1', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k1'));
select is((select res ->> 'ok' from r where step = 'k1'), 'true', 'consume k1 succeeds');
select is((select res ->> 'credit_source' from r where step = 'k1'), 'included', 'consume k1 uses an included credit');
select is((select (res ->> 'included_credits')::int from r where step = 'k1'), 4, 'included credits go from 5 to 4');

-- Same key again is idempotent
insert into r values ('k1-again', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k1'));
select is((select res ->> 'already_consumed' from r where step = 'k1-again'), 'true', 'replaying k1 reports already_consumed');
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 4, 'replaying k1 does not consume again');
select is(
  (select included_delta from public.ai_credit_ledger where user_id = '11111111-1111-1111-1111-111111111111' and idempotency_key = 'analysis_consume:k1'),
  -1, 'ledger records -1 for k1'
);

-- Exhausting the 5 welcome credits dates welcome_exhausted_at
select public.consume_ai_credit('11111111-1111-1111-1111-111111111111', k) from unnest(array['k2', 'k3', 'k4', 'k5']) as k;
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'five consumptions exhaust the welcome credits');
select isnt((select welcome_exhausted_at from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), null, 'welcome_exhausted_at is set on the last welcome credit');

-- No credit left and the Free monthly credit is not due yet
insert into r values ('k6', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k6'));
select is((select res ->> 'code' from r where step = 'k6'), 'NO_CREDITS', 'consume k6 fails with NO_CREDITS');

-- Refunding the consumption that exhausted the welcome credits
insert into r values ('refund-k5', public.refund_ai_credit('11111111-1111-1111-1111-111111111111', 'k5'));
select is((select res ->> 'ok' from r where step = 'refund-k5'), 'true', 'refund k5 succeeds');
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 1, 'refund k5 restores one included credit');
select is((select welcome_exhausted_at from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), null, 'refund k5 clears welcome_exhausted_at');
insert into r values ('refund-k5-again', public.refund_ai_credit('11111111-1111-1111-1111-111111111111', 'k5'));
select is((select res ->> 'already_refunded' from r where step = 'refund-k5-again'), 'true', 'replaying refund k5 is idempotent');
insert into r values ('refund-unknown', public.refund_ai_credit('11111111-1111-1111-1111-111111111111', 'unknown'));
select is((select res ->> 'code' from r where step = 'refund-unknown'), 'CONSUMPTION_NOT_FOUND', 'refunding an unknown key fails');

select public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k7');
select isnt((select welcome_exhausted_at from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), null, 'welcome_exhausted_at is set again');

-- Free monthly credit: due one month after the welcome credits ran out
update public.ai_credit_balances
set welcome_exhausted_at = now() - interval '1 month 1 day'
where user_id = '11111111-1111-1111-1111-111111111111';
insert into r values ('k8', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k8'));
select is((select res ->> 'ok' from r where step = 'k8'), 'true', 'consume k8 uses the Free monthly credit');
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'the Free monthly credit is consumed immediately');
select is((select last_free_monthly_grant_at from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), now(), 'last_free_monthly_grant_at is set');
select is(
  (select included_delta from public.ai_credit_ledger where user_id = '11111111-1111-1111-1111-111111111111' and idempotency_key = 'free_monthly:k8'),
  1, 'ledger records the free_monthly grant'
);
insert into r values ('k9', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k9'));
select is((select res ->> 'code' from r where step = 'k9'), 'NO_CREDITS', 'the Free monthly credit is not cumulative');

-- Refunding a Free monthly credit makes it available again, never stored (M8)
select public.refund_ai_credit('11111111-1111-1111-1111-111111111111', 'k8');
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'a refunded Free monthly credit is not stored as an included credit');

-- Purchased credits are used last
update public.ai_credit_balances set purchased_credits = 2 where user_id = '11111111-1111-1111-1111-111111111111';
insert into r values ('k10', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k10'));
select is((select res ->> 'credit_source' from r where step = 'k10'), 'included', 'the Free monthly credit made available again is used before purchased ones');
insert into r values ('k11', public.consume_ai_credit('11111111-1111-1111-1111-111111111111', 'k11'));
select is((select res ->> 'credit_source' from r where step = 'k11'), 'purchased', 'purchased credits are used once included ones run out');
select is((select purchased_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 1, 'one purchased credit consumed');
select public.refund_ai_credit('11111111-1111-1111-1111-111111111111', 'k11');
select is((select purchased_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 2, 'refunding a purchased credit restores it');

-- Effective Premium accounts never get the Free monthly credit
update public.user_entitlements
set tier = 'premium', billing_period = 'monthly', subscription_status = 'active',
    current_period_start_at = now() - interval '1 day', current_period_end_at = now() + interval '29 days'
where user_id = '33333333-3333-3333-3333-333333333333';
update public.ai_credit_balances
set included_credits = 0, welcome_exhausted_at = now() - interval '2 months'
where user_id = '33333333-3333-3333-3333-333333333333';
insert into r values ('p1', public.consume_ai_credit('33333333-3333-3333-3333-333333333333', 'p1'));
select is((select res ->> 'code' from r where step = 'p1'), 'NO_CREDITS', 'premium account gets no Free monthly credit');

-- Missing state and invalid arguments
insert into r values ('missing', public.consume_ai_credit('99999999-9999-9999-9999-999999999999', 'm1'));
select is((select res ->> 'code' from r where step = 'missing'), 'MONETIZATION_STATE_MISSING', 'unknown user has no monetization state');
select throws_ok(
  $$ select public.consume_ai_credit('11111111-1111-1111-1111-111111111111', ' ') $$,
  'P0001', null, 'a blank request key is rejected'
);

-- Privileges: service_role only
select ok(not has_function_privilege('authenticated', 'public.consume_ai_credit(uuid, text)', 'execute'), 'authenticated cannot execute consume_ai_credit');
select ok(not has_function_privilege('anon', 'public.consume_ai_credit(uuid, text)', 'execute'), 'anon cannot execute consume_ai_credit');
select ok(has_function_privilege('service_role', 'public.consume_ai_credit(uuid, text)', 'execute'), 'service_role can execute consume_ai_credit');
select ok(not has_function_privilege('authenticated', 'public.refund_ai_credit(uuid, text)', 'execute'), 'authenticated cannot execute refund_ai_credit');
select ok(not has_function_privilege('anon', 'public.refund_ai_credit(uuid, text)', 'execute'), 'anon cannot execute refund_ai_credit');
select ok(has_function_privilege('service_role', 'public.refund_ai_credit(uuid, text)', 'execute'), 'service_role can execute refund_ai_credit');
select ok(has_table_privilege('service_role', 'public.ai_credit_balances', 'update'), 'service_role can update ai_credit_balances');
select ok(has_table_privilege('service_role', 'public.ai_credit_ledger', 'insert'), 'service_role can insert into ai_credit_ledger');

select * from finish();
rollback;
