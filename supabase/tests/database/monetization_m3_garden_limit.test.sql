-- Tests for the Free garden limit trigger (M3), following effective Premium
-- since M7. Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- Sets a Premium entitlement with the given status and period end.
create function pg_temp.set_premium(uid uuid, status text, period_end timestamptz) returns void language sql as $$
  update public.user_entitlements
  set tier = 'premium', billing_period = 'monthly', subscription_status = status,
      current_period_start_at = now() - interval '1 month', current_period_end_at = period_end
  where user_id = uid;
$$;

-- Inserts n plants for uid, one statement per plant.
create function pg_temp.add_plants(uid uuid, n integer) returns void language plpgsql as $$
begin
  for i in 1..n loop
    insert into public.plants (user_id, common_name) values (uid, 'Test plant ' || i);
  end loop;
end;
$$;

-- F: Free. P: active. X: expired. D: past_due. G: grace_period.
-- C: canceled, paid until a future end. K: canceled, end passed.
-- N: active without an end. M: no entitlement.
select pg_temp.new_user(u)
from unnest(array[
  '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777',
  '88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
]::uuid[]) as u;

select pg_temp.set_premium('33333333-3333-3333-3333-333333333333', 'active', now() + interval '29 days');
select pg_temp.set_premium('44444444-4444-4444-4444-444444444444', 'expired', now() - interval '1 month');
select pg_temp.set_premium('66666666-6666-6666-6666-666666666666', 'past_due', now() + interval '29 days');
select pg_temp.set_premium('77777777-7777-7777-7777-777777777777', 'grace_period', now() + interval '3 days');
select pg_temp.set_premium('88888888-8888-8888-8888-888888888888', 'canceled', now() + interval '10 days');
select pg_temp.set_premium('99999999-9999-9999-9999-999999999999', 'canceled', now() - interval '1 day');
select pg_temp.set_premium('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active', null);
delete from public.user_entitlements where user_id = '55555555-5555-5555-5555-555555555555';

-- The trigger is still attached, enabled, BEFORE INSERT FOR EACH ROW
select has_trigger('public', 'plants', 'enforce_free_garden_limit', 'garden limit trigger exists');
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.plants'::regclass
      and tgname = 'enforce_free_garden_limit'
      and tgfoid = 'public.enforce_free_garden_limit()'::regprocedure
      and tgtype = 7
      and tgenabled = 'O'
  ),
  'garden limit trigger calls enforce_free_garden_limit, before insert, for each row, enabled'
);

-- Free: 10 plants allowed, the 11th is refused
select lives_ok($$ select pg_temp.add_plants('11111111-1111-1111-1111-111111111111', 10) $$, 'a Free account can keep 10 plants');
select is((select count(*)::int from public.plants where user_id = '11111111-1111-1111-1111-111111111111'), 10, 'the Free account has 10 plants');
select throws_ok(
  $$ select pg_temp.add_plants('11111111-1111-1111-1111-111111111111', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'the 11th plant is refused for a Free account'
);

-- Effective Premium: unlimited
select lives_ok($$ select pg_temp.add_plants('33333333-3333-3333-3333-333333333333', 11) $$, 'an active Premium account can add an 11th plant');
select lives_ok($$ select pg_temp.add_plants('77777777-7777-7777-7777-777777777777', 11) $$, 'a Premium account in grace_period can add an 11th plant');
select lives_ok($$ select pg_temp.add_plants('88888888-8888-8888-8888-888888888888', 11) $$, 'a canceled Premium account paid until a future end can add an 11th plant');

-- Not effective Premium: limited like Free
select lives_ok($$ select pg_temp.add_plants('44444444-4444-4444-4444-444444444444', 10) $$, 'an expired Premium account can keep 10 plants');
select throws_ok(
  $$ select pg_temp.add_plants('44444444-4444-4444-4444-444444444444', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'an expired Premium account cannot add an 11th plant'
);
select throws_ok(
  $$ select pg_temp.add_plants('66666666-6666-6666-6666-666666666666', 11) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'a past_due Premium account cannot add an 11th plant'
);
select throws_ok(
  $$ select pg_temp.add_plants('99999999-9999-9999-9999-999999999999', 11) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'a canceled Premium account past its end cannot add an 11th plant'
);
select throws_ok(
  $$ select pg_temp.add_plants('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 11) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'an active Premium account without an end cannot add an 11th plant'
);

-- End of Premium: existing plants are kept, new ones are refused
select pg_temp.set_premium('33333333-3333-3333-3333-333333333333', 'expired', now() - interval '1 day');
select is((select count(*)::int from public.plants where user_id = '33333333-3333-3333-3333-333333333333'), 11, 'an expired account keeps its existing plants');
select throws_ok(
  $$ select pg_temp.add_plants('33333333-3333-3333-3333-333333333333', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'an expired account above the limit cannot add plants'
);
update public.user_entitlements set tier = 'free' where user_id = '77777777-7777-7777-7777-777777777777';
select throws_ok(
  $$ select pg_temp.add_plants('77777777-7777-7777-7777-777777777777', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'an account moved back to tier free above the limit cannot add plants'
);

-- Missing monetization state
select throws_ok(
  $$ select pg_temp.add_plants('55555555-5555-5555-5555-555555555555', 1) $$,
  'P0001', 'MONETIZATION_STATE_MISSING', 'a plant cannot be added without an entitlement row'
);

-- Execute privileges unchanged by M7
select ok(not has_function_privilege('authenticated', 'public.enforce_free_garden_limit()', 'execute'), 'authenticated cannot execute the trigger function directly');
select ok(not has_function_privilege('anon', 'public.enforce_free_garden_limit()', 'execute'), 'anon cannot execute the trigger function directly');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.enforce_free_garden_limit()'::regprocedure and a.grantee = 0
  ),
  'PUBLIC has no privilege on the trigger function'
);

select * from finish();
rollback;
