-- Tests for the Free reminder-plant limit trigger (M4), following effective
-- Premium since M7. Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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

-- F: Free. P: active. X: expired. D: past_due. G: grace_period.
-- C: canceled, paid until a future end. K: canceled, end passed.
-- N: active without an end.
create temp table test_users (uid uuid primary key) on commit drop;
insert into test_users values
  ('11111111-1111-1111-1111-111111111111'), ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444'), ('66666666-6666-6666-6666-666666666666'),
  ('77777777-7777-7777-7777-777777777777'), ('88888888-8888-8888-8888-888888888888'),
  ('99999999-9999-9999-9999-999999999999'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.new_user(uid) from test_users;

-- Plants are created while every account is still Free (6 plants each).
select pg_temp.add_plant(uid, n) from test_users, generate_series(1, 6) as n;

select pg_temp.set_premium('33333333-3333-3333-3333-333333333333', 'active', now() + interval '29 days');
select pg_temp.set_premium('44444444-4444-4444-4444-444444444444', 'expired', now() - interval '1 month');
select pg_temp.set_premium('66666666-6666-6666-6666-666666666666', 'past_due', now() + interval '29 days');
select pg_temp.set_premium('77777777-7777-7777-7777-777777777777', 'grace_period', now() + interval '3 days');
select pg_temp.set_premium('88888888-8888-8888-8888-888888888888', 'canceled', now() + interval '10 days');
select pg_temp.set_premium('99999999-9999-9999-9999-999999999999', 'canceled', now() - interval '1 day');
select pg_temp.set_premium('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active', null);

-- The trigger is still attached, enabled, BEFORE INSERT OR UPDATE FOR EACH ROW
select has_trigger('public', 'plant_reminders', 'enforce_free_reminder_plant_limit', 'reminder limit trigger exists');
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.plant_reminders'::regclass
      and tgname = 'enforce_free_reminder_plant_limit'
      and tgfoid = 'public.enforce_free_reminder_plant_limit()'::regprocedure
      and tgtype = 23
      and tgenabled = 'O'
  ),
  'reminder limit trigger calls enforce_free_reminder_plant_limit, before insert or update, for each row, enabled'
);

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

-- Effective Premium: unlimited
select lives_ok($$
  select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', n) from generate_series(1, 5) as n
$$, 'an active Premium account can set reminders on 5 plants');
select lives_ok($$
  select pg_temp.add_reminder('77777777-7777-7777-7777-777777777777', n) from generate_series(1, 4) as n
$$, 'a Premium account in grace_period can set reminders on 4 plants');
select lives_ok($$
  select pg_temp.add_reminder('88888888-8888-8888-8888-888888888888', n) from generate_series(1, 4) as n
$$, 'a canceled Premium account paid until a future end can set reminders on 4 plants');

-- Not effective Premium: limited like Free
select lives_ok($$
  select pg_temp.add_reminder('44444444-4444-4444-4444-444444444444', n) from generate_series(1, 3) as n
$$, 'an expired Premium account can set reminders on 3 plants');
select throws_ok(
  $$ select pg_temp.add_reminder('44444444-4444-4444-4444-444444444444', 4) $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'an expired Premium account cannot add a 4th reminder plant'
);
select throws_ok(
  $$ select pg_temp.add_reminder('66666666-6666-6666-6666-666666666666', n) from generate_series(1, 4) as n $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'a past_due Premium account cannot set reminders on 4 plants'
);
select throws_ok(
  $$ select pg_temp.add_reminder('99999999-9999-9999-9999-999999999999', n) from generate_series(1, 4) as n $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'a canceled Premium account past its end cannot set reminders on 4 plants'
);
select throws_ok(
  $$ select pg_temp.add_reminder('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', n) from generate_series(1, 4) as n $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'an active Premium account without an end cannot set reminders on 4 plants'
);

-- End of Premium: existing reminder plants are kept and editable, no new plant
select pg_temp.set_premium('33333333-3333-3333-3333-333333333333', 'expired', now() - interval '1 day');
select lives_ok(
  $$ update public.plant_reminders set note = 'edited' where user_id = '33333333-3333-3333-3333-333333333333' $$,
  'an expired account can still edit its reminders'
);
select lives_ok(
  $$ select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', 1, 'pruning') $$,
  'an expired account can add a reminder on a plant that already has one'
);
select throws_ok(
  $$ select pg_temp.add_reminder('33333333-3333-3333-3333-333333333333', 6) $$,
  'P0001', 'FREE_REMINDER_PLANT_LIMIT_REACHED', 'an expired account cannot add a new reminder plant'
);

-- Execute privileges unchanged by M7
select ok(not has_function_privilege('authenticated', 'public.enforce_free_reminder_plant_limit()', 'execute'), 'authenticated cannot execute the trigger function directly');
select ok(not has_function_privilege('anon', 'public.enforce_free_reminder_plant_limit()', 'execute'), 'anon cannot execute the trigger function directly');
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.enforce_free_reminder_plant_limit()'::regprocedure and a.grantee = 0
  ),
  'PUBLIC has no privilege on the trigger function'
);

select * from finish();
rollback;
