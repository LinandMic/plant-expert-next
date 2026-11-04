-- Baseline tests for monetization foundation M1 (current behavior).
-- Runs only against the local database (npx supabase test db), inside a
-- transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

select pg_temp.new_user('11111111-1111-1111-1111-111111111111');
select pg_temp.new_user('22222222-2222-2222-2222-222222222222');

-- Tables
select has_table('public', 'user_entitlements', 'user_entitlements exists');
select has_table('public', 'ai_credit_balances', 'ai_credit_balances exists');
select has_table('public', 'ai_credit_ledger', 'ai_credit_ledger exists');

-- handle_new_user: Free entitlement, 5 welcome credits, one ledger row
select is((select tier from public.user_entitlements where user_id = '11111111-1111-1111-1111-111111111111'), 'free', 'new account is free');
select is((select subscription_status from public.user_entitlements where user_id = '11111111-1111-1111-1111-111111111111'), 'inactive', 'new account subscription is inactive');
select is((select billing_period from public.user_entitlements where user_id = '11111111-1111-1111-1111-111111111111'), null, 'new account has no billing period');
select is((select included_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 5, 'new account gets 5 included credits');
select is((select purchased_credits from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'new account has 0 purchased credits');
select is((select welcome_exhausted_at from public.ai_credit_balances where user_id = '11111111-1111-1111-1111-111111111111'), null, 'welcome_exhausted_at starts empty');
select results_eq(
  $$ select reason, included_delta, purchased_delta, idempotency_key from public.ai_credit_ledger where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('free_welcome'::text, 5, 0, 'free_welcome'::text) $$,
  'exactly one free_welcome ledger row of +5'
);

-- Ledger constraints
select throws_ok(
  $$ update public.ai_credit_ledger set included_delta = 50 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'P0001', 'ai_credit_ledger is append-only', 'ledger rows cannot be updated'
);
select throws_ok(
  $$ delete from public.ai_credit_ledger where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'P0001', 'ai_credit_ledger is append-only', 'ledger rows cannot be deleted'
);
select throws_ok(
  $$ insert into public.ai_credit_ledger (user_id, included_delta, reason) values ('11111111-1111-1111-1111-111111111111', 1, 'bogus') $$,
  '23514', null, 'unknown ledger reason is rejected'
);
select throws_ok(
  $$ insert into public.ai_credit_ledger (user_id, included_delta, reason, idempotency_key) values ('11111111-1111-1111-1111-111111111111', 5, 'free_welcome', 'free_welcome') $$,
  '23505', null, 'idempotency key is unique per user'
);
select throws_ok(
  $$ insert into public.ai_credit_ledger (user_id, included_delta, purchased_delta, reason) values ('11111111-1111-1111-1111-111111111111', 0, 0, 'admin_adjustment') $$,
  '23514', null, 'a ledger row cannot have a zero delta'
);

-- RLS and privileges
select ok((select relrowsecurity from pg_class where oid = 'public.user_entitlements'::regclass), 'RLS enabled on user_entitlements');
select ok((select relrowsecurity from pg_class where oid = 'public.ai_credit_balances'::regclass), 'RLS enabled on ai_credit_balances');
select ok((select relrowsecurity from pg_class where oid = 'public.ai_credit_ledger'::regclass), 'RLS enabled on ai_credit_ledger');
select ok(has_table_privilege('authenticated', 'public.user_entitlements', 'select'), 'authenticated can select user_entitlements');
select ok(has_table_privilege('authenticated', 'public.ai_credit_balances', 'select'), 'authenticated can select ai_credit_balances');
select ok(not has_table_privilege('authenticated', 'public.user_entitlements', 'update'), 'authenticated cannot update user_entitlements');
select ok(not has_table_privilege('authenticated', 'public.ai_credit_balances', 'update'), 'authenticated cannot update ai_credit_balances');
select ok(not has_table_privilege('authenticated', 'public.ai_credit_ledger', 'select'), 'authenticated has no table privilege on ai_credit_ledger');
select ok(not has_table_privilege('anon', 'public.user_entitlements', 'select'), 'anon cannot select user_entitlements');

-- An authenticated user only sees their own rows
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.user_entitlements), 1, 'authenticated user sees only their own entitlement');
select is((select count(*)::int from public.ai_credit_balances), 1, 'authenticated user sees only their own balance');
reset role;

select * from finish();
rollback;
