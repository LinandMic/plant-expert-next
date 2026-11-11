-- Tests for the monthly credits of the annual Premium plan (M10): the rule
-- in premium_monthly_due, the grant in consume_ai_credit and the status
-- fields. Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- now() minus m months (computed in UTC like premium_monthly_due) minus extra.
create function pg_temp.ago(m integer, extra interval) returns timestamptz language sql as $$
  select ((now() at time zone 'UTC') - make_interval(months => m)) at time zone 'UTC' - extra;
$$;

create function pg_temp.plus_months(ts timestamptz, m integer) returns timestamptz language sql as $$
  select ((ts at time zone 'UTC') + make_interval(months => m)) at time zone 'UTC';
$$;

-- Sets included_credits through an admin_adjustment ledger row, so the
-- ledger keeps matching the balance.
create function pg_temp.set_included(uid uuid, n integer) returns void language plpgsql as $$
declare
  d integer;
begin
  select n - included_credits into d from public.ai_credit_balances where user_id = uid;
  if d <> 0 then
    update public.ai_credit_balances set included_credits = n where user_id = uid;
    insert into public.ai_credit_ledger (user_id, included_delta, reason, idempotency_key)
    values (uid, d, 'admin_adjustment', 'test_set_included:' || gen_random_uuid());
  end if;
end;
$$;

create function pg_temp.status(uid uuid) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return public.get_monetization_status();
end;
$$;

create function pg_temp.bal(uid uuid) returns public.ai_credit_balances language sql as $$
  select * from public.ai_credit_balances where user_id = uid;
$$;

create function pg_temp.ledger_matches(uid uuid) returns boolean language sql as $$
  select coalesce(sum(l.included_delta), 0) = b.included_credits
     and coalesce(sum(l.purchased_delta), 0) = b.purchased_credits
  from public.ai_credit_balances b
  left join public.ai_credit_ledger l on l.user_id = b.user_id
  where b.user_id = uid
  group by b.included_credits, b.purchased_credits;
$$;

create function pg_temp.annual_month_rows(uid uuid) returns integer language sql as $$
  select count(*)::integer from public.ai_credit_ledger
  where user_id = uid and idempotency_key like 'premium_annual_month:%';
$$;

-- premium_monthly_due at fixed dates (active annual, ends 2028-01-31).
create function pg_temp.due(status text, plan text, last_grant timestamptz, included integer, at timestamptz,
                            period_end timestamptz default '2028-01-31 10:00+00', tier text default 'premium')
returns record language sql as $$
  select d.months_due, d.credits_due, d.through_at, d.next_at
  from public.premium_monthly_due(tier, status, period_end, plan, last_grant, included, at) d;
$$;

create temp table r (step text primary key, res jsonb) on commit drop;
create temp table t (name text primary key, ts timestamptz) on commit drop;

select pg_temp.new_user(u)
from unnest(array[
  'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002',
  'b3000000-0000-0000-0000-000000000003', 'b4000000-0000-0000-0000-000000000004',
  'b5000000-0000-0000-0000-000000000005', 'b6000000-0000-0000-0000-000000000006',
  'b7000000-0000-0000-0000-000000000007'
]::uuid[]) as u;

-- B1: annual, one month due, 10 included credits
insert into t values ('b1', pg_temp.ago(1, '1 day'));
select public.grant_premium_period('b1000000-0000-0000-0000-000000000001', 'b1', 'annual', (select ts from t where name = 'b1'), (select ts from t where name = 'b1') + interval '1 year');
select pg_temp.set_included('b1000000-0000-0000-0000-000000000001', 10);

select is((pg_temp.status('b1000000-0000-0000-0000-000000000001') ->> 'premium_monthly_due')::int, 25, 'status shows the 25 credits of the month due');
select is((pg_temp.status('b1000000-0000-0000-0000-000000000001') ->> 'available_credits')::int, 35, 'available credits include the month due');
select is(
  (pg_temp.status('b1000000-0000-0000-0000-000000000001') ->> 'next_premium_monthly_at')::timestamptz,
  pg_temp.plus_months((select ts from t where name = 'b1'), 2),
  'status shows the date of the next month'
);
insert into r values ('u1', public.consume_ai_credit('b1000000-0000-0000-0000-000000000001', 'u1'));
select is((pg_temp.bal('b1000000-0000-0000-0000-000000000001')).included_credits, 34, 'consume grants the month then consumes (10 + 25 - 1)');
select is((pg_temp.bal('b1000000-0000-0000-0000-000000000001')).last_premium_monthly_grant_at, pg_temp.plus_months((select ts from t where name = 'b1'), 1), 'the start date moves to the month granted');
select is(
  (select included_delta from public.ai_credit_ledger
   where user_id = 'b1000000-0000-0000-0000-000000000001' and reason = 'premium_monthly'
     and idempotency_key = 'premium_annual_month:' || to_char(pg_temp.plus_months((select ts from t where name = 'b1'), 1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  25, 'ledger records premium_monthly +25 keyed by the due month'
);
select is((pg_temp.status('b1000000-0000-0000-0000-000000000001') ->> 'premium_monthly_due')::int, 0, 'nothing is due after the grant');
select is(
  (pg_temp.status('b1000000-0000-0000-0000-000000000001') ->> 'next_premium_monthly_at')::timestamptz,
  pg_temp.plus_months((select ts from t where name = 'b1'), 2),
  'the next month date is unchanged by the grant'
);
insert into r values ('u1-again', public.consume_ai_credit('b1000000-0000-0000-0000-000000000001', 'u1'));
select is((select res ->> 'already_consumed' from r where step = 'u1-again'), 'true', 'a replayed consumption reports already_consumed');
select is((pg_temp.bal('b1000000-0000-0000-0000-000000000001')).included_credits, 34, 'a replayed consumption grants nothing');
select public.consume_ai_credit('b1000000-0000-0000-0000-000000000001', 'u2');
select is((pg_temp.bal('b1000000-0000-0000-0000-000000000001')).included_credits, 33, 'a second consumption in the same month grants nothing');
select is(pg_temp.annual_month_rows('b1000000-0000-0000-0000-000000000001'), 1, 'the month is granted once');
select ok(pg_temp.ledger_matches('b1000000-0000-0000-0000-000000000001'), 'ledger equals balance');

-- B2: three months due, 10 included credits: 25 + 15 + 0
insert into t values ('b2', pg_temp.ago(3, '1 day'));
select public.grant_premium_period('b2000000-0000-0000-0000-000000000002', 'b2', 'annual', (select ts from t where name = 'b2'), (select ts from t where name = 'b2') + interval '1 year');
select pg_temp.set_included('b2000000-0000-0000-0000-000000000002', 10);
select is((pg_temp.status('b2000000-0000-0000-0000-000000000002') ->> 'premium_monthly_due')::int, 40, 'catch-up of 3 months shows 40 (capped at 50)');
select public.consume_ai_credit('b2000000-0000-0000-0000-000000000002', 'c1');
select is((pg_temp.bal('b2000000-0000-0000-0000-000000000002')).included_credits, 49, 'catch-up grants 40 then consumes 1');
select is((pg_temp.bal('b2000000-0000-0000-0000-000000000002')).last_premium_monthly_grant_at, pg_temp.plus_months((select ts from t where name = 'b2'), 3), 'the start date moves to the last due month');
select is(pg_temp.annual_month_rows('b2000000-0000-0000-0000-000000000002'), 2, 'one ledger row per month granted more than 0 (25 and 15)');
select ok(pg_temp.ledger_matches('b2000000-0000-0000-0000-000000000002'), 'catch-up: ledger equals balance');

-- B3: three months due from 0 included credits
insert into t values ('b3', pg_temp.ago(3, '1 day'));
select public.grant_premium_period('b3000000-0000-0000-0000-000000000003', 'b3', 'annual', (select ts from t where name = 'b3'), (select ts from t where name = 'b3') + interval '1 year');
select pg_temp.set_included('b3000000-0000-0000-0000-000000000003', 0);
select is((pg_temp.status('b3000000-0000-0000-0000-000000000003') ->> 'premium_monthly_due')::int, 50, 'catch-up from 0 stops at 50');
select is((pg_temp.status('b3000000-0000-0000-0000-000000000003') ->> 'available_credits')::int, 50, 'available credits are 50');

-- B4: at the cap with a month due
insert into t values ('b4', pg_temp.ago(1, '1 day'));
select public.grant_premium_period('b4000000-0000-0000-0000-000000000004', 'b4', 'annual', (select ts from t where name = 'b4'), (select ts from t where name = 'b4') + interval '1 year');
select is((pg_temp.status('b4000000-0000-0000-0000-000000000004') ->> 'premium_monthly_due')::int, 0, 'at 50 included credits nothing is shown as due');
select public.consume_ai_credit('b4000000-0000-0000-0000-000000000004', 'k1');
select is((pg_temp.bal('b4000000-0000-0000-0000-000000000004')).included_credits, 49, 'at 50 the month grants 0 before consuming (50 - 1)');
select is(pg_temp.annual_month_rows('b4000000-0000-0000-0000-000000000004'), 0, 'a month capped to 0 writes no ledger row');
select is((pg_temp.bal('b4000000-0000-0000-0000-000000000004')).last_premium_monthly_grant_at, pg_temp.plus_months((select ts from t where name = 'b4'), 1), 'a month capped to 0 still moves the start date');
select public.refund_ai_credit('b4000000-0000-0000-0000-000000000004', 'k1');
select is((pg_temp.bal('b4000000-0000-0000-0000-000000000004')).included_credits, 50, 'the refund restores the included credit');
select ok(pg_temp.ledger_matches('b4000000-0000-0000-0000-000000000004'), 'cap: ledger equals balance');

-- B5: past_due, then active again on the same period
insert into t values ('b5', pg_temp.ago(1, '1 day'));
select public.grant_premium_period('b5000000-0000-0000-0000-000000000005', 'b5', 'annual', (select ts from t where name = 'b5'), (select ts from t where name = 'b5') + interval '1 year');
select pg_temp.set_included('b5000000-0000-0000-0000-000000000005', 10);
update public.user_entitlements set subscription_status = 'past_due' where user_id = 'b5000000-0000-0000-0000-000000000005';
select is((pg_temp.status('b5000000-0000-0000-0000-000000000005') ->> 'premium_monthly_due')::int, 0, 'past_due: nothing shown as due');
select ok(pg_temp.status('b5000000-0000-0000-0000-000000000005') -> 'next_premium_monthly_at' = 'null'::jsonb, 'past_due: no next month date');
select public.consume_ai_credit('b5000000-0000-0000-0000-000000000005', 'pd1');
select is((pg_temp.bal('b5000000-0000-0000-0000-000000000005')).included_credits, 9, 'past_due: consume grants nothing');
select is((pg_temp.bal('b5000000-0000-0000-0000-000000000005')).last_premium_monthly_grant_at, (select ts from t where name = 'b5'), 'past_due: the start date does not move');
update public.user_entitlements set subscription_status = 'active' where user_id = 'b5000000-0000-0000-0000-000000000005';
select is((pg_temp.status('b5000000-0000-0000-0000-000000000005') ->> 'premium_monthly_due')::int, 25, 'back to active on the same period: the month is caught up');

-- B6: monthly plan, never an M10 grant
insert into t values ('b6', pg_temp.ago(1, '1 day'));
select public.grant_premium_period('b6000000-0000-0000-0000-000000000006', 'b6', 'monthly', (select ts from t where name = 'b6'), now() + interval '29 days');
select pg_temp.set_included('b6000000-0000-0000-0000-000000000006', 10);
select is((pg_temp.status('b6000000-0000-0000-0000-000000000006') ->> 'premium_monthly_due')::int, 0, 'monthly plan: nothing shown as due');
select ok(pg_temp.status('b6000000-0000-0000-0000-000000000006') -> 'next_premium_monthly_at' = 'null'::jsonb, 'monthly plan: no next month date');
select public.consume_ai_credit('b6000000-0000-0000-0000-000000000006', 'mo1');
select is((pg_temp.bal('b6000000-0000-0000-0000-000000000006')).included_credits, 9, 'monthly plan: consume grants nothing');

-- B7: annual renewal (M9) then the 13th month (M10), no new 50
insert into t values ('b7', pg_temp.ago(12, '0'));
select public.grant_premium_period('b7000000-0000-0000-0000-000000000007', 'b7-y1', 'annual', (select ts from t where name = 'b7'), now() + interval '1 hour');
update public.ai_credit_balances set last_premium_monthly_grant_at = pg_temp.ago(1, '1 day')
where user_id = 'b7000000-0000-0000-0000-000000000007';
select pg_temp.set_included('b7000000-0000-0000-0000-000000000007', 10);
insert into r values ('b7-y2', public.grant_premium_period('b7000000-0000-0000-0000-000000000007', 'b7-y2', 'annual', now() + interval '1 hour', now() + interval '1 year 1 hour'));
select is((select res ->> 'kind' from r where step = 'b7-y2'), 'renewal', 'the second year is a renewal');
select is((select (res ->> 'credits_granted')::int from r where step = 'b7-y2'), 0, 'the annual renewal grants no new 50');
select is((pg_temp.bal('b7000000-0000-0000-0000-000000000007')).last_premium_monthly_grant_at, pg_temp.ago(1, '1 day'), 'the annual renewal keeps the monthly start date');
select is((pg_temp.status('b7000000-0000-0000-0000-000000000007') ->> 'premium_monthly_due')::int, 25, 'the next month after the renewal is due normally');

-- premium_monthly_due at fixed dates
select ok(
  (select months_due = 1 and through_at = '2027-02-28 10:00+00' and next_at = '2027-03-31 10:00+00'
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'from Jan 31: due Feb 28, next Mar 31 (dates from the start, not chained)'
);
select ok(
  (select months_due = 0
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 09:59:59.999999+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'not due one microsecond before'
);
select ok(
  (select months_due = 2 and credits_due = 50 and through_at = '2027-03-31 10:00+00'
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 0, '2027-03-31 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'two months due from 0: 50'
);
select ok(
  (select credits_due = 10
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 40, '2027-03-31 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'two months due from 40: capped to 10'
);
select ok(
  (select credits_due = 0 and months_due = 1
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 55, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'above 50 (after a refund): the month is due but grants 0'
);
select ok(
  (select months_due = 1
   from pg_temp.due('grace_period', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'grace_period: the month is due'
);
select ok(
  (select months_due = 1
   from pg_temp.due('canceled', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'canceled but paid: the month is due'
);
select ok(
  (select months_due = 1 and next_at is null
   from pg_temp.due('canceled', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00', '2027-03-15 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'canceled ending before the next month: no next month date'
);
select ok(
  (select next_at = '2027-03-31 10:00+00'
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00', '2027-03-15 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'active (renewing) ending before the next month: next month date shown'
);
select ok(
  (select months_due = 0 and credits_due = 0 and through_at is null and next_at is null
   from pg_temp.due('past_due', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'past_due: nothing due, no next date'
);
select ok(
  (select months_due = 0 and next_at is null
   from pg_temp.due('expired', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'expired: nothing due, no next date'
);
select ok(
  (select months_due = 0 and next_at is null
   from pg_temp.due('active', 'monthly', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'monthly plan: nothing due, no next date'
);
select ok(
  (select months_due = 0 and next_at is null
   from pg_temp.due('active', 'annual', '2027-01-31 10:00+00', 0, '2027-02-28 10:00+00', '2028-01-31 10:00+00', 'free') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'Free tier: nothing due, no next date'
);
select ok(
  (select months_due = 0 and next_at is null
   from pg_temp.due('active', 'annual', null, 0, '2027-02-28 10:00+00') as d(months_due int, credits_due int, through_at timestamptz, next_at timestamptz)),
  'no start date: nothing due, no next date'
);

-- premium_monthly_due itself
select is(
  (select provolatile::text from pg_proc where oid = 'public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)'::regprocedure),
  'i', 'premium_monthly_due is immutable'
);
select isnt(
  obj_description('public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)'::regprocedure, 'pg_proc'),
  null, 'premium_monthly_due has a comment'
);
select ok(has_function_privilege('authenticated', 'public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)', 'execute'), 'authenticated can execute premium_monthly_due');
select ok(has_function_privilege('service_role', 'public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)', 'execute'), 'service_role can execute premium_monthly_due');
select ok(not has_function_privilege('anon', 'public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)', 'execute'), 'anon cannot execute premium_monthly_due');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.premium_monthly_due(text, text, timestamptz, text, timestamptz, integer, timestamptz)'::regprocedure
      and a.grantee = 0
  ),
  'PUBLIC has no privilege on premium_monthly_due'
);

select * from finish();
rollback;
