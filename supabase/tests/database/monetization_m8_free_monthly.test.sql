-- Tests for the Free monthly credit on effective Premium (M8): the rule in
-- consume_ai_credit and get_monetization_status, the refund of a Free
-- monthly credit, and free_monthly_due. Runs only against the local
-- database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- Sets a Premium entitlement with the given status and period end.
create function pg_temp.set_premium(uid uuid, status text, period_end timestamptz) returns void language sql as $$
  update public.user_entitlements
  set tier = 'premium', billing_period = 'monthly', subscription_status = status,
      current_period_start_at = period_end - interval '1 month', current_period_end_at = period_end
  where user_id = uid;
$$;

-- Consumes n credits with keys <prefix>1..<prefix>n.
create function pg_temp.consume_n(uid uuid, prefix text, n integer) returns void language plpgsql as $$
begin
  for i in 1..n loop
    perform public.consume_ai_credit(uid, prefix || i);
  end loop;
end;
$$;

-- free_monthly_available as reported to the user by get_monetization_status.
create function pg_temp.shown(uid uuid) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return (public.get_monetization_status() ->> 'free_monthly_available')::boolean;
end;
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

create function pg_temp.balance(uid uuid) returns public.ai_credit_balances language sql as $$
  select * from public.ai_credit_balances where user_id = uid;
$$;

create temp table r (step text primary key, res jsonb) on commit drop;

-- A: Free, welcome credits used up 1 month and 1 day ago.
-- B: Free, welcome credits used up 20 days ago.
-- D: was Premium while using its 5 credits (welcome_exhausted_at never set), ended 1 month and 1 day ago.
-- E: same as D, ended 10 days ago.
-- F: Free monthly credit received before a Premium period that ended 20 days ago.
-- G: effective Premium (active, grace_period, canceled with a future end).
-- H: past_due with a future end.
-- I: former Premium using its last included credit.
-- J: refund after a later monthly grant. K: refund of a pre-M8 monthly grant.
select pg_temp.new_user(u)
from unnest(array[
  'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
  'd0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000e',
  'f0000000-0000-0000-0000-00000000000f', '70000000-0000-0000-0000-000000000007',
  '80000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'
]::uuid[]) as u;

-- Free accounts use up their welcome credits while Free.
select pg_temp.consume_n(u, 'w', 5)
from unnest(array[
  'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
  'f0000000-0000-0000-0000-00000000000f', '70000000-0000-0000-0000-000000000007',
  '80000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
]::uuid[]) as u;
update public.ai_credit_balances set welcome_exhausted_at = now() - interval '1 month 1 day'
where user_id = 'a0000000-0000-0000-0000-00000000000a';
update public.ai_credit_balances set welcome_exhausted_at = now() - interval '20 days'
where user_id = 'b0000000-0000-0000-0000-00000000000b';
update public.ai_credit_balances set welcome_exhausted_at = now() - interval '6 months'
where user_id in ('f0000000-0000-0000-0000-00000000000f', '70000000-0000-0000-0000-000000000007',
                  '80000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
                  '20000000-0000-0000-0000-000000000002');

-- D and E use their 5 credits while Premium, then their period ends.
select pg_temp.set_premium(u, 'active', now() + interval '10 days')
from unnest(array['d0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000e']::uuid[]) as u;
select pg_temp.consume_n(u, 'p', 5)
from unnest(array['d0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000e']::uuid[]) as u;
select pg_temp.set_premium('d0000000-0000-0000-0000-00000000000d', 'expired', now() - interval '1 month 1 day');
select pg_temp.set_premium('e0000000-0000-0000-0000-00000000000e', 'expired', now() - interval '10 days');

-- F received a monthly credit 5 months ago, then had Premium until 20 days ago.
update public.ai_credit_balances set last_free_monthly_grant_at = now() - interval '5 months'
where user_id = 'f0000000-0000-0000-0000-00000000000f';
select pg_temp.set_premium('f0000000-0000-0000-0000-00000000000f', 'expired', now() - interval '20 days');

-- Free, normal case
select ok(pg_temp.shown('a0000000-0000-0000-0000-00000000000a'), 'Free: monthly credit shown one month after the welcome credits ran out');
insert into r values ('a1', public.consume_ai_credit('a0000000-0000-0000-0000-00000000000a', 'a1'));
select is((select res ->> 'credit_source' from r where step = 'a1'), 'included', 'Free: the monthly credit pays the analysis');
select ok(not pg_temp.shown('a0000000-0000-0000-0000-00000000000a'), 'Free: no second monthly credit in the same month');
select ok(not pg_temp.shown('b0000000-0000-0000-0000-00000000000b'), 'Free: no monthly credit 20 days after the welcome credits ran out');
select is(public.consume_ai_credit('b0000000-0000-0000-0000-00000000000b', 'b1') ->> 'code', 'NO_CREDITS', 'Free: consume refuses before the month has passed');

-- Exact boundary, through free_monthly_due
select ok(
  public.free_monthly_due('free', 'inactive', null, 0, '2026-10-06 12:00+00', null, '2026-11-06 12:00+00'),
  'free_monthly_due: due exactly one month later'
);
select ok(
  not public.free_monthly_due('free', 'inactive', null, 0, '2026-10-06 12:00+00', null, '2026-11-06 11:59:59.999999+00'),
  'free_monthly_due: not due one microsecond before'
);

-- Former Premium that never used up its welcome credits while Free
select is((pg_temp.balance('d0000000-0000-0000-0000-00000000000d')).welcome_exhausted_at, null, 'credits used while Premium do not date the end of the welcome credits');
select ok(pg_temp.shown('d0000000-0000-0000-0000-00000000000d'), 'former Premium: monthly credit shown one month after the period ended');
insert into r values ('d1', public.consume_ai_credit('d0000000-0000-0000-0000-00000000000d', 'd1'));
select is((select res ->> 'credit_source' from r where step = 'd1'), 'included', 'former Premium: the monthly credit pays the analysis');
select ok(pg_temp.ledger_matches('d0000000-0000-0000-0000-00000000000d'), 'former Premium: ledger equals balance');
select ok(not pg_temp.shown('e0000000-0000-0000-0000-00000000000e'), 'former Premium: no monthly credit 10 days after the period ended');
select is(public.consume_ai_credit('e0000000-0000-0000-0000-00000000000e', 'e1') ->> 'code', 'NO_CREDITS', 'former Premium: consume refuses 10 days after the period ended');

-- The end of the Premium period wins over an older monthly grant
select ok(not pg_temp.shown('f0000000-0000-0000-0000-00000000000f'), 'an older monthly grant does not bypass the month after the period end');
select is(public.consume_ai_credit('f0000000-0000-0000-0000-00000000000f', 'f1') ->> 'code', 'NO_CREDITS', 'consume agrees: no monthly credit before period end + 1 month');

-- Effective Premium: never the Free monthly credit
select pg_temp.set_premium('70000000-0000-0000-0000-000000000007', 'active', now() + interval '10 days');
select ok(not pg_temp.shown('70000000-0000-0000-0000-000000000007'), 'active Premium: no Free monthly credit shown');
select is(public.consume_ai_credit('70000000-0000-0000-0000-000000000007', 'g1') ->> 'code', 'NO_CREDITS', 'active Premium: consume gives no Free monthly credit');
select pg_temp.set_premium('70000000-0000-0000-0000-000000000007', 'grace_period', now() + interval '3 days');
select ok(not pg_temp.shown('70000000-0000-0000-0000-000000000007'), 'grace_period: no Free monthly credit shown');
select is(public.consume_ai_credit('70000000-0000-0000-0000-000000000007', 'g2') ->> 'code', 'NO_CREDITS', 'grace_period: consume gives no Free monthly credit');
select pg_temp.set_premium('70000000-0000-0000-0000-000000000007', 'canceled', now() + interval '10 days');
select ok(not pg_temp.shown('70000000-0000-0000-0000-000000000007'), 'canceled but paid: no Free monthly credit shown');
select is(public.consume_ai_credit('70000000-0000-0000-0000-000000000007', 'g3') ->> 'code', 'NO_CREDITS', 'canceled but paid: consume gives no Free monthly credit');

-- past_due: not Premium, but no monthly credit before period end + 1 month
select pg_temp.set_premium('80000000-0000-0000-0000-000000000008', 'past_due', now() + interval '10 days');
select ok(not pg_temp.shown('80000000-0000-0000-0000-000000000008'), 'past_due with a future end: no Free monthly credit shown');
select is(public.consume_ai_credit('80000000-0000-0000-0000-000000000008', 'h1') ->> 'code', 'NO_CREDITS', 'past_due with a future end: consume gives no Free monthly credit');
select pg_temp.set_premium('80000000-0000-0000-0000-000000000008', 'past_due', now() - interval '1 month 1 day');
select ok(pg_temp.shown('80000000-0000-0000-0000-000000000008'), 'past_due: Free monthly credit one month after the period end');

-- A former Premium using its last included credit starts the monthly clock
select pg_temp.set_premium('90000000-0000-0000-0000-000000000009', 'active', now() + interval '10 days');
select pg_temp.consume_n('90000000-0000-0000-0000-000000000009', 'i', 4);
select pg_temp.set_premium('90000000-0000-0000-0000-000000000009', 'expired', now() - interval '1 day');
select public.consume_ai_credit('90000000-0000-0000-0000-000000000009', 'i5');
select is((pg_temp.balance('90000000-0000-0000-0000-000000000009')).welcome_exhausted_at, now(), 'a former Premium using its last included credit dates welcome_exhausted_at');

-- Refund of a Free monthly credit: available again, never stored
insert into r values ('refund-a1', public.refund_ai_credit('a0000000-0000-0000-0000-00000000000a', 'a1'));
select is((select res ->> 'ok' from r where step = 'refund-a1'), 'true', 'refund of a monthly credit succeeds');
select is((select res ->> 'free_monthly_restored' from r where step = 'refund-a1'), 'true', 'refund restores the monthly credit');
select is((pg_temp.balance('a0000000-0000-0000-0000-00000000000a')).included_credits, 0, 'refund does not store the monthly credit');
select is((pg_temp.balance('a0000000-0000-0000-0000-00000000000a')).last_free_monthly_grant_at, null, 'refund puts back the previous last_free_monthly_grant_at');
select ok(pg_temp.shown('a0000000-0000-0000-0000-00000000000a'), 'the monthly credit is shown again after the refund');
select is(
  (select included_delta from public.ai_credit_ledger
   where user_id = 'a0000000-0000-0000-0000-00000000000a' and idempotency_key = 'free_monthly_reversal:a1' and reason = 'free_monthly'),
  -1, 'ledger records the monthly grant reversal'
);
select ok(pg_temp.ledger_matches('a0000000-0000-0000-0000-00000000000a'), 'ledger equals balance after the refund');
insert into r values ('refund-a1-again', public.refund_ai_credit('a0000000-0000-0000-0000-00000000000a', 'a1'));
select is((select res ->> 'already_refunded' from r where step = 'refund-a1-again'), 'true', 'replaying the refund is idempotent');
select ok(pg_temp.ledger_matches('a0000000-0000-0000-0000-00000000000a'), 'ledger still equals balance after the replay');
insert into r values ('a2', public.consume_ai_credit('a0000000-0000-0000-0000-00000000000a', 'a2'));
select is((select res ->> 'ok' from r where step = 'a2'), 'true', 'the restored monthly credit can be used');

-- Refund after a later monthly grant: nothing restored, nothing stored.
-- now() is fixed inside the test transaction, so the later grant is
-- simulated by moving last_free_monthly_grant_at one month ahead.
select public.consume_ai_credit('10000000-0000-0000-0000-000000000001', 'j1');
update public.ai_credit_balances set last_free_monthly_grant_at = now() + interval '1 month'
where user_id = '10000000-0000-0000-0000-000000000001';
insert into r values ('refund-j1', public.refund_ai_credit('10000000-0000-0000-0000-000000000001', 'j1'));
select is((select res ->> 'ok' from r where step = 'refund-j1'), 'true', 'refund after a later monthly grant succeeds');
select is((select res ->> 'free_monthly_restored' from r where step = 'refund-j1'), 'false', 'refund after a later monthly grant restores nothing');
select is((pg_temp.balance('10000000-0000-0000-0000-000000000001')).last_free_monthly_grant_at, now() + interval '1 month', 'the later grant date is kept');
select is((pg_temp.balance('10000000-0000-0000-0000-000000000001')).included_credits, 0, 'refund after a later monthly grant stores nothing');
select is(
  (select count(*)::int from public.ai_credit_ledger
   where user_id = '10000000-0000-0000-0000-000000000001' and idempotency_key in ('analysis_refund:j1', 'free_monthly_reversal:j1')),
  2, 'refund after a later monthly grant still writes both ledger rows'
);
select ok(pg_temp.ledger_matches('10000000-0000-0000-0000-000000000001'), 'ledger equals balance after a refund that restores nothing');
insert into r values ('refund-j1-again', public.refund_ai_credit('10000000-0000-0000-0000-000000000001', 'j1'));
select is((select res ->> 'already_refunded' from r where step = 'refund-j1-again'), 'true', 'replaying that refund is idempotent');

-- Refund of a monthly grant made before M8 (no previous_grant_at)
insert into public.ai_credit_ledger (user_id, included_delta, purchased_delta, reason, idempotency_key, metadata, created_at) values
  ('20000000-0000-0000-0000-000000000002', 1, 0, 'free_monthly', 'free_monthly:k1', jsonb_build_object('request_id', 'k1'), now() - interval '1 minute'),
  ('20000000-0000-0000-0000-000000000002', -1, 0, 'analysis_consumed', 'analysis_consume:k1',
   jsonb_build_object('request_id', 'k1', 'credit_source', 'included', 'welcome_exhausted_now', false), now() - interval '1 minute');
update public.ai_credit_balances set last_free_monthly_grant_at = now() - interval '1 minute'
where user_id = '20000000-0000-0000-0000-000000000002';
insert into r values ('refund-k1', public.refund_ai_credit('20000000-0000-0000-0000-000000000002', 'k1'));
select is((select res ->> 'free_monthly_restored' from r where step = 'refund-k1'), 'true', 'refund of a pre-M8 monthly grant restores it');
select is((pg_temp.balance('20000000-0000-0000-0000-000000000002')).last_free_monthly_grant_at, null, 'a pre-M8 monthly grant is restored to null');
select ok(pg_temp.ledger_matches('20000000-0000-0000-0000-000000000002'), 'ledger equals balance after refunding a pre-M8 monthly grant');

-- free_monthly_due itself
select is(
  (select provolatile::text from pg_proc where oid = 'public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)'::regprocedure),
  'i', 'free_monthly_due is immutable'
);
select isnt(
  obj_description('public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)'::regprocedure, 'pg_proc'),
  null, 'free_monthly_due has a comment'
);
select ok(has_function_privilege('authenticated', 'public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)', 'execute'), 'authenticated can execute free_monthly_due');
select ok(has_function_privilege('service_role', 'public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)', 'execute'), 'service_role can execute free_monthly_due');
select ok(not has_function_privilege('anon', 'public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)', 'execute'), 'anon cannot execute free_monthly_due');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.free_monthly_due(text, text, timestamptz, integer, timestamptz, timestamptz, timestamptz)'::regprocedure
      and a.grantee = 0
  ),
  'PUBLIC has no privilege on free_monthly_due'
);

select * from finish();
rollback;
