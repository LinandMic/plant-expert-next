-- Baseline tests for the Free reminder-plant limit trigger (M4), current
-- behavior. Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

-- Creates plant number n for uid with a predictable id.
create function pg_temp.plant_id(uid uuid, n integer) returns uuid language sql immutable as $$
  select (left(uid::text, 24) || lpad(n::text, 12, '0'))::uuid;
$$;

create function pg_temp.add_plant(uid uuid, n integer) returns void language sql as $$
  insert into public.plants (id, user_id, common_name) values (pg_temp.plant_id(uid, n), uid, 'Test plant ' || n);
$$;

create function pg_temp.add_reminder(uid uuid, n integer, reminder_type text default 'watering') returns void language sql as $$
  insert into public.plant_reminders (user_id, plant_id, type, next_due_date)
  values (uid, pg_temp.plant_id(uid, n), reminder_type, current_date + 1);
$$;

-- F: Free. P: active Premium. X: Premium that has expired.
select pg_temp.new_user('11111111-1111-1111-1111-111111111111');
select pg_temp.new_user('33333333-3333-3333-3333-333333333333');
select pg_temp.new_user('44444444-4444-4444-4444-444444444444');

update public.user_entitlements
set tier = 'premium', billing_period = 'monthly', subscription_status = 'active',
    current_period_start_at = now() - interval '1 day', current_period_end_at = now() + interval '29 days'
where user_id = '33333333-3333-3333-3333-333333333333';
update public.user_entitlements
set tier = 'premium', billing_period = 'monthly', subscription_status = 'expired',
    current_period_start_at = now() - interval '2 months', current_period_end_at = now() - interval '1 month'
where user_id = '44444444-4444-4444-4444-444444444444';

select pg_temp.add_plant(u, n)
from unnest(array[
  '11111111-1111-1111-1111-111111111111'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '44444444-4444-4444-4444-444444444444'::uuid
]) as u, generate_series(1, 6) as n;

select has_trigger('public', 'plant_reminders', 'enforce_free_reminder_plant_limit', 'reminder limit trigger exists');

-- Free: 3 distinct plants
select lives_ok($$
  select pg_temp.add_reminder('11111111-1111-1111-1111-111111111111', n) from generate_series(1, 3) as n
$$, 'a Free account can set reminders on 3 plants');
select lives_ok(
  $$ select pg_temp.add_reminder('11111111-1111-1111-1111-111111111111', 1, 'pruning') $$,
  'a second reminder on the same plant does not use a new slot'
);
select throws_ok(
  $$ select pg_temp.add_reminder('11111111-1111-1111-1111-111111111111', 4) $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'a 4th reminder plant is refused for a Free account'
);
select lives_ok(
  $$ update public.plant_reminders set note = 'edited' where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'existing reminders can be edited'
);
select lives_ok(
  $$ update public.plant_reminders
     set plant_id = pg_temp.plant_id('11111111-1111-1111-1111-111111111111', 4)
     where plant_id = pg_temp.plant_id('11111111-1111-1111-1111-111111111111', 3) $$,
  'moving a reminder to another plant keeps the count at 3'
);

-- Premium: unlimited
select lives_ok($$
  select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', n) from generate_series(1, 5) as n
$$, 'an active Premium account can set reminders on 5 plants');

-- Downgrade: existing reminder plants are kept and editable, no new plant
update public.user_entitlements set tier = 'free' where user_id = '33333333-3333-3333-3333-333333333333';
select lives_ok(
  $$ update public.plant_reminders set note = 'edited' where user_id = '33333333-3333-3333-3333-333333333333' $$,
  'a downgraded account can still edit its reminders'
);
select lives_ok(
  $$ select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', 1, 'pruning') $$,
  'a downgraded account can add a reminder on a plant that already has one'
);
select throws_ok(
  $$ select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', 6) $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'a downgraded account cannot add a new reminder plant'
);

-- CURRENT BEHAVIOR (to change in M7): an expired Premium account is still
-- unlimited because the trigger only looks at tier.
select lives_ok($$
  select pg_temp.add_reminder('44444444-4444-4444-4444-444444444444', n) from generate_series(1, 4) as n
$$, 'baseline: an expired Premium account is still unlimited');

select * from finish();
rollback;
