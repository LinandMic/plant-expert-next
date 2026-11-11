-- Tests for grant_premium_period (M9): credits per kind of period, the cap
-- of 50, idempotency, refusals and privileges. Runs only against the local
-- database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- Consumes n credits with keys <prefix>1..<prefix>n.
create function pg_temp.consume_n(uid uuid, prefix text, n integer) returns void language plpgsql as $$
begin
  for i in 1..n loop
    perform public.consume_ai_credit(uid, prefix || i);
  end loop;
end;
$$;

create function pg_temp.grant(uid uuid, k text, plan text, starts timestamptz, ends timestamptz) returns jsonb language sql as $$
  select public.grant_premium_period(uid, k, plan, starts, ends);
$$;

create function pg_temp.ent(uid uuid) returns public.user_entitlements language sql as $$
  select * from public.user_entitlements where user_id = uid;
$$;

create function pg_temp.bal(uid uuid) returns public.ai_credit_balances language sql as $$
  select * from public.ai_credit_balances where user_id = uid;
$$;

-- The ledger sums equal the balance.
create function pg_temp.ledger_matches(uid uuid) returns boolean language sql as $$
  select coalesce(sum(l.included_delta), 0) = b.included_credits
     and coalesce(sum(l.purchased_delta), 0) = b.purchased_credits
  from public.ai_credit_balances b
  left join public.ai_credit_ledger l on l.user_id = b.user_id
  where b.user_id = uid
  group by b.included_credits, b.purchased_credits;
$$;

create temp table r (step text primary key, res jsonb) on commit drop;

-- M: monthly, A: annual from 0, W: annual with 3 welcome credits left,
-- X: re-subscription after expiry, G: re-subscription after a gap,
-- P: purchased credits, Z: no entitlement.
select pg_temp.new_user(u)
from unnest(array[
  'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000004',
  'a5000000-0000-0000-0000-000000000005', 'a6000000-0000-0000-0000-000000000006',
  'a7000000-0000-0000-0000-000000000007'
]::uuid[]) as u;
delete from public.user_entitlements where user_id = 'a7000000-0000-0000-0000-000000000007';

-- First monthly activation (5 welcome credits left)
insert into r values ('m1', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm1', 'monthly', now() - interval '1 day', now() + interval '29 days'));
select is((select res ->> 'ok' from r where step = 'm1'), 'true', 'monthly activation succeeds');
select is((select res ->> 'kind' from r where step = 'm1'), 'activation', 'first period is an activation');
select is((select (res ->> 'credits_granted')::int from r where step = 'm1'), 25, 'monthly activation grants 25');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).included_credits, 30, 'included credits go from 5 to 30');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).tier, 'premium', 'tier becomes premium');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).subscription_status, 'active', 'status becomes active');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).billing_period, 'monthly', 'billing_period is recorded');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).current_period_end_at, now() + interval '29 days', 'period end is recorded');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).last_premium_monthly_grant_at, now() - interval '1 day', 'last_premium_monthly_grant_at is the period start');
select is(
  (select included_delta from public.ai_credit_ledger
   where user_id = 'a1000000-0000-0000-0000-000000000001' and idempotency_key = 'premium_grant:m1' and reason = 'premium_activation'),
  25, 'ledger records premium_activation +25'
);
select ok(
  public.is_premium_effective('premium', 'active', (pg_temp.ent('a1000000-0000-0000-0000-000000000001')).current_period_end_at, now()),
  'the account is effective Premium'
);
select lives_ok($$
  insert into public.plants (user_id, common_name)
  select 'a1000000-0000-0000-0000-000000000001', 'Test plant ' || n from generate_series(1, 11) as n
$$, 'the Free garden limit no longer applies');

-- Replay
insert into r values ('m1-again', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm1', 'monthly', now() - interval '1 day', now() + interval '29 days'));
select is((select res ->> 'already_granted' from r where step = 'm1-again'), 'true', 'replaying the same grant_key reports already_granted');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).included_credits, 30, 'replay grants nothing');
select is((select count(*)::int from public.premium_period_grants where user_id = 'a1000000-0000-0000-0000-000000000001'), 1, 'replay records no second period');

-- Monthly renewal, capped at 50
insert into r values ('m2', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm2', 'monthly', now() + interval '29 days', now() + interval '59 days'));
select is((select res ->> 'kind' from r where step = 'm2'), 'renewal', 'next contiguous period is a renewal');
select is((select (res ->> 'credits_granted')::int from r where step = 'm2'), 20, 'monthly renewal grants 25 capped to 20 (30 + 20 = 50)');
select is((select res ->> 'capped' from r where step = 'm2'), 'true', 'the renewal reports capped');
select is(
  (select reason from public.ai_credit_ledger where user_id = 'a1000000-0000-0000-0000-000000000001' and idempotency_key = 'premium_grant:m2'),
  'premium_monthly', 'ledger records premium_monthly'
);
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).current_period_end_at, now() + interval '59 days', 'renewal extends the period end');

-- At the cap: period recorded, nothing granted, no ledger row
insert into r values ('m3', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm3', 'monthly', now() + interval '59 days', now() + interval '89 days'));
select is((select (res ->> 'credits_granted')::int from r where step = 'm3'), 0, 'a renewal at 50 included credits grants 0');
select is((select count(*)::int from public.ai_credit_ledger where user_id = 'a1000000-0000-0000-0000-000000000001' and idempotency_key = 'premium_grant:m3'), 0, 'a grant of 0 writes no ledger row');
select is((select credits_granted from public.premium_period_grants where user_id = 'a1000000-0000-0000-0000-000000000001' and grant_key = 'm3'), 0, 'the capped period is still recorded');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).current_period_end_at, now() + interval '89 days', 'a capped renewal still extends the period');

-- Replay of a capped period after consuming credits still grants nothing
select pg_temp.consume_n('a1000000-0000-0000-0000-000000000001', 'c', 10);
insert into r values ('m3-again', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm3', 'monthly', now() + interval '59 days', now() + interval '89 days'));
select is((select res ->> 'already_granted' from r where step = 'm3-again'), 'true', 'replaying a capped period reports already_granted');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).included_credits, 40, 'replaying a capped period after consumption grants nothing');

-- Refunds are not capped (decision 8)
select pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm4', 'monthly', now() + interval '89 days', now() + interval '119 days');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).included_credits, 50, 'the next renewal fills up to 50');
select public.refund_ai_credit('a1000000-0000-0000-0000-000000000001', 'c1');
select is((pg_temp.bal('a1000000-0000-0000-0000-000000000001')).included_credits, 51, 'a refund can bring included credits above 50');
select ok(pg_temp.ledger_matches('a1000000-0000-0000-0000-000000000001'), 'monthly account: ledger equals balance');

-- Out-of-order period
insert into r values ('stale', pg_temp.grant('a1000000-0000-0000-0000-000000000001', 'm-old', 'monthly', now() + interval '29 days', now() + interval '59 days'));
select is((select res ->> 'code' from r where step = 'stale'), 'STALE_PERIOD', 'a period ending before the current end is refused');
select is((pg_temp.ent('a1000000-0000-0000-0000-000000000001')).current_period_end_at, now() + interval '119 days', 'a stale period does not move the dates back');
select is((select count(*)::int from public.premium_period_grants where user_id = 'a1000000-0000-0000-0000-000000000001' and grant_key = 'm-old'), 0, 'a stale period is not recorded');

-- First annual activation from 0 included credits
select pg_temp.consume_n('a2000000-0000-0000-0000-000000000002', 'w', 5);
insert into r values ('a1', pg_temp.grant('a2000000-0000-0000-0000-000000000002', 'a1', 'annual', now() - interval '1 day', now() + interval '364 days'));
select is((select (res ->> 'credits_granted')::int from r where step = 'a1'), 50, 'annual activation grants 50');
select is((pg_temp.ent('a2000000-0000-0000-0000-000000000002')).billing_period, 'annual', 'billing_period annual is recorded');

-- Annual renewal: no new 50, monthly date left for M10
insert into r values ('a2', pg_temp.grant('a2000000-0000-0000-0000-000000000002', 'a2', 'annual', now() + interval '364 days', now() + interval '729 days'));
select is((select res ->> 'kind' from r where step = 'a2'), 'renewal', 'next annual period is a renewal');
select is((select (res ->> 'credits_granted')::int from r where step = 'a2'), 0, 'annual renewal grants no new 50');
select is((select count(*)::int from public.ai_credit_ledger where user_id = 'a2000000-0000-0000-0000-000000000002' and idempotency_key = 'premium_grant:a2'), 0, 'annual renewal writes no ledger row');
select is((pg_temp.ent('a2000000-0000-0000-0000-000000000002')).current_period_end_at, now() + interval '729 days', 'annual renewal extends the period');
select is((pg_temp.bal('a2000000-0000-0000-0000-000000000002')).last_premium_monthly_grant_at, now() - interval '1 day', 'annual renewal keeps last_premium_monthly_grant_at');
select ok(pg_temp.ledger_matches('a2000000-0000-0000-0000-000000000002'), 'annual account: ledger equals balance');

-- Annual activation with 3 welcome credits left: capped at 50
select pg_temp.consume_n('a3000000-0000-0000-0000-000000000003', 'w', 2);
insert into r values ('w1', pg_temp.grant('a3000000-0000-0000-0000-000000000003', 'w1', 'annual', now() - interval '1 day', now() + interval '364 days'));
select is((select (res ->> 'credits_granted')::int from r where step = 'w1'), 47, 'annual activation with 3 credits left grants 47');
select is((pg_temp.bal('a3000000-0000-0000-0000-000000000003')).included_credits, 50, 'included credits stop at 50');

-- Re-subscription after expiry: 25, even annual
select pg_temp.consume_n('a4000000-0000-0000-0000-000000000004', 'w', 5);
select pg_temp.grant('a4000000-0000-0000-0000-000000000004', 'x1', 'monthly', now() - interval '2 months', now() - interval '1 month');
update public.user_entitlements set subscription_status = 'expired' where user_id = 'a4000000-0000-0000-0000-000000000004';
update public.ai_credit_balances set included_credits = 0 where user_id = 'a4000000-0000-0000-0000-000000000004';
insert into public.ai_credit_ledger (user_id, included_delta, reason, idempotency_key) values
  ('a4000000-0000-0000-0000-000000000004', -25, 'admin_adjustment', 'test_reset:x1');
insert into r values ('x2', pg_temp.grant('a4000000-0000-0000-0000-000000000004', 'x2', 'annual', now(), now() + interval '365 days'));
select is((select res ->> 'kind' from r where step = 'x2'), 'reactivation', 'a new period after expiry is a re-subscription');
select is((select (res ->> 'credits_granted')::int from r where step = 'x2'), 25, 'an annual re-subscription grants 25, not 50');
select is(
  (select reason || ':' || (metadata ->> 'kind') from public.ai_credit_ledger
   where user_id = 'a4000000-0000-0000-0000-000000000004' and idempotency_key = 'premium_grant:x2'),
  'premium_activation:reactivation', 'ledger records premium_activation with kind reactivation'
);
select is((pg_temp.ent('a4000000-0000-0000-0000-000000000004')).subscription_status, 'active', 'a re-subscription sets the status back to active');
select ok(pg_temp.ledger_matches('a4000000-0000-0000-0000-000000000004'), 're-subscribed account: ledger equals balance');

-- Re-subscription after a gap (status still active, period ended)
select pg_temp.grant('a5000000-0000-0000-0000-000000000005', 'g1', 'monthly', now() - interval '40 days', now() - interval '10 days');
insert into r values ('g2', pg_temp.grant('a5000000-0000-0000-0000-000000000005', 'g2', 'monthly', now(), now() + interval '30 days'));
select is((select res ->> 'kind' from r where step = 'g2'), 'reactivation', 'a period starting after a gap is a re-subscription');
select is((select (res ->> 'credits_granted')::int from r where step = 'g2'), 20, 're-subscription grants 25 capped to 20 (30 + 20 = 50)');

-- Purchased credits are neither counted nor changed
update public.ai_credit_balances set included_credits = 40, purchased_credits = 30
where user_id = 'a6000000-0000-0000-0000-000000000006';
insert into r values ('p1', pg_temp.grant('a6000000-0000-0000-0000-000000000006', 'p1', 'annual', now(), now() + interval '365 days'));
select is((select (res ->> 'credits_granted')::int from r where step = 'p1'), 10, 'the cap only counts included credits');
select is((pg_temp.bal('a6000000-0000-0000-0000-000000000006')).purchased_credits, 30, 'purchased credits are unchanged');

-- Refusals
select is(pg_temp.grant('a7000000-0000-0000-0000-000000000007', 'z1', 'monthly', now(), now() + interval '30 days') ->> 'code', 'MONETIZATION_STATE_MISSING', 'missing entitlement is reported');
select throws_ok($$ select pg_temp.grant('a6000000-0000-0000-0000-000000000006', ' ', 'monthly', now(), now() + interval '30 days') $$, 'P0001', null, 'a blank grant_key is rejected');
select throws_ok($$ select pg_temp.grant('a6000000-0000-0000-0000-000000000006', 'bad', 'weekly', now(), now() + interval '30 days') $$, 'P0001', null, 'an unknown billing_period is rejected');
select throws_ok($$ select pg_temp.grant('a6000000-0000-0000-0000-000000000006', 'bad', 'monthly', now(), now()) $$, 'P0001', null, 'a period ending at its start is rejected');

-- Function privileges
select ok(has_function_privilege('service_role', 'public.grant_premium_period(uuid, text, text, timestamptz, timestamptz)', 'execute'), 'service_role can execute grant_premium_period');
select ok(not has_function_privilege('authenticated', 'public.grant_premium_period(uuid, text, text, timestamptz, timestamptz)', 'execute'), 'authenticated cannot execute grant_premium_period');
select ok(not has_function_privilege('anon', 'public.grant_premium_period(uuid, text, text, timestamptz, timestamptz)', 'execute'), 'anon cannot execute grant_premium_period');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.grant_premium_period(uuid, text, text, timestamptz, timestamptz)'::regprocedure and a.grantee = 0
  ),
  'PUBLIC has no privilege on grant_premium_period'
);
select ok(
  exists (
    select 1 from pg_proc p
    where p.oid = 'public.grant_premium_period(uuid, text, text, timestamptz, timestamptz)'::regprocedure
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig = array['search_path=""']
  ),
  'grant_premium_period is SECURITY DEFINER, owned by postgres, with an empty search_path'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'premium_period_grants'),
  0, 'premium_period_grants has no RLS policy'
);

-- service_role reads premium_period_grants and calls the function, but cannot
-- write either table directly
set local role service_role;
select lives_ok($$ select count(*) from public.premium_period_grants $$, 'service_role can read premium_period_grants');
select lives_ok(
  $$ select public.grant_premium_period('a5000000-0000-0000-0000-000000000005', 'g3', 'monthly', now() + interval '30 days', now() + interval '60 days') $$,
  'service_role can grant a period through the function'
);
select throws_ok(
  $$ update public.user_entitlements set tier = 'premium' where user_id = 'a6000000-0000-0000-0000-000000000006' $$,
  '42501', null, 'service_role cannot update user_entitlements directly'
);
select throws_ok(
  $$ insert into public.premium_period_grants (user_id, grant_key, kind, billing_period, period_start_at, period_end_at, credits_planned, credits_granted, capped)
     values ('a6000000-0000-0000-0000-000000000006', 'direct', 'activation', 'monthly', now(), now() + interval '30 days', 25, 25, false) $$,
  '42501', null, 'service_role cannot insert into premium_period_grants directly'
);
reset role;

select * from finish();
rollback;
