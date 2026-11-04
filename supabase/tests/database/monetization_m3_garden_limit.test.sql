-- Baseline tests for the Free garden limit trigger (M3), current behavior.
-- Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- Inserts n plants for uid, one statement per plant.
create function pg_temp.add_plants(uid uuid, n integer) returns void language plpgsql as $$
begin
  for i in 1..n loop
    insert into public.plants (user_id, common_name) values (uid, 'Test plant ' || i);
  end loop;
end;
$$;

-- F: Free. P: active Premium. X: Premium that has expired. M: no entitlement.
select pg_temp.new_user('11111111-1111-1111-1111-111111111111');
select pg_temp.new_user('33333333-3333-3333-3333-333333333333');
select pg_temp.new_user('44444444-4444-4444-4444-444444444444');
select pg_temp.new_user('55555555-5555-5555-5555-555555555555');

update public.user_entitlements
set tier = 'premium', billing_period = 'monthly', subscription_status = 'active',
    current_period_start_at = now() - interval '1 day', current_period_end_at = now() + interval '29 days'
where user_id = '33333333-3333-3333-3333-333333333333';
update public.user_entitlements
set tier = 'premium', billing_period = 'monthly', subscription_status = 'expired',
    current_period_start_at = now() - interval '2 months', current_period_end_at = now() - interval '1 month'
where user_id = '44444444-4444-4444-4444-444444444444';
delete from public.user_entitlements where user_id = '55555555-5555-5555-5555-555555555555';

select has_trigger('public', 'plants', 'enforce_free_garden_limit', 'garden limit trigger exists');

-- Free: 10 plants allowed, the 11th is refused
select lives_ok($$ select pg_temp.add_plants('11111111-1111-1111-1111-111111111111', 10) $$, 'a Free account can keep 10 plants');
select is((select count(*)::int from public.plants where user_id = '11111111-1111-1111-1111-111111111111'), 10, 'the Free account has 10 plants');
select throws_ok(
  $$ select pg_temp.add_plants('11111111-1111-1111-1111-111111111111', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'the 11th plant is refused for a Free account'
);

-- Premium: unlimited
select lives_ok($$ select pg_temp.add_plants('33333333-3333-3333-3333-333333333333', 11) $$, 'an active Premium account can add an 11th plant');

-- CURRENT BEHAVIOR (to change in M7): the trigger only looks at tier, so an
-- expired Premium account is still unlimited.
select lives_ok($$ select pg_temp.add_plants('44444444-4444-4444-4444-444444444444', 11) $$, 'baseline: an expired Premium account is still unlimited');

-- Downgrade: existing plants are kept, new ones are refused
update public.user_entitlements set tier = 'free' where user_id = '33333333-3333-3333-3333-333333333333';
select is((select count(*)::int from public.plants where user_id = '33333333-3333-3333-3333-333333333333'), 11, 'a downgraded account keeps its existing plants');
select throws_ok(
  $$ select pg_temp.add_plants('33333333-3333-3333-3333-333333333333', 1) $$,
  'P0001', 'FREE_GARDEN_LIMIT_REACHED', 'a downgraded account above the limit cannot add plants'
);

-- Missing monetization state
select throws_ok(
  $$ select pg_temp.add_plants('55555555-5555-5555-5555-555555555555', 1) $$,
  'P0001', 'MONETIZATION_STATE_MISSING', 'a plant cannot be added without an entitlement row'
);

select ok(not has_function_privilege('authenticated', 'public.enforce_free_garden_limit()', 'execute'), 'authenticated cannot execute the trigger function directly');

select * from finish();
rollback;
