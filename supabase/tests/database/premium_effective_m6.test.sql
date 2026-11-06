-- Tests for is_premium_effective (M6): the full truth table and privileges.
-- Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create temp table cases (n int primary key, tier text, status text, period_end timestamptz, expected boolean, label text) on commit drop;
insert into cases values
  (1,  'premium', 'active',       '2026-12-06 12:00+00', true,  'premium active with a future end is Premium'),
  (2,  'premium', 'grace_period', '2026-12-06 12:00+00', true,  'premium grace_period with a future end is Premium'),
  (3,  'premium', 'canceled',     '2026-12-06 12:00+00', true,  'premium canceled but paid until a future end is Premium'),
  (4,  'premium', 'past_due',     '2026-12-06 12:00+00', false, 'premium past_due is not Premium'),
  (5,  'premium', 'expired',      '2026-12-06 12:00+00', false, 'premium expired is not Premium'),
  (6,  'premium', 'inactive',     '2026-12-06 12:00+00', false, 'premium inactive is not Premium'),
  (7,  'premium', 'active',       '2026-10-06 12:00+00', false, 'premium active with a past end is not Premium'),
  (8,  'premium', 'grace_period', '2026-10-06 12:00+00', false, 'premium grace_period with a past end is not Premium'),
  (9,  'premium', 'canceled',     '2026-10-06 12:00+00', false, 'premium canceled with a past end is not Premium'),
  (10, 'premium', 'active',       null,                  false, 'premium active without an end is not Premium'),
  (11, 'premium', 'active',       '2026-11-06 12:00+00', false, 'an end equal to the reference time is not Premium'),
  (12, 'free',    'active',       '2026-12-06 12:00+00', false, 'free with an active future period is not Premium'),
  (13, 'free',    'inactive',     null,                  false, 'a default Free entitlement is not Premium'),
  (14, null,      'active',       '2026-12-06 12:00+00', false, 'a null tier is not Premium');

select is(
  public.is_premium_effective(tier, status, period_end, '2026-11-06 12:00+00'),
  expected,
  label
)
from cases
order by n;

select is(
  (select provolatile::text from pg_proc where oid = 'public.is_premium_effective(text, text, timestamptz, timestamptz)'::regprocedure),
  'i', 'is_premium_effective is immutable'
);
select isnt(
  obj_description('public.is_premium_effective(text, text, timestamptz, timestamptz)'::regprocedure, 'pg_proc'),
  null, 'is_premium_effective has a comment'
);

select ok(has_function_privilege('authenticated', 'public.is_premium_effective(text, text, timestamptz, timestamptz)', 'execute'), 'authenticated can execute is_premium_effective');
select ok(has_function_privilege('service_role', 'public.is_premium_effective(text, text, timestamptz, timestamptz)', 'execute'), 'service_role can execute is_premium_effective');
select ok(not has_function_privilege('anon', 'public.is_premium_effective(text, text, timestamptz, timestamptz)', 'execute'), 'anon cannot execute is_premium_effective');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.is_premium_effective(text, text, timestamptz, timestamptz)'::regprocedure
      and a.grantee = 0
  ),
  'PUBLIC has no privilege on is_premium_effective'
);

select * from finish();
rollback;
