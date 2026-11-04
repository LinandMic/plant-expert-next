-- Baseline tests for get_monetization_status (M5), current behavior.
-- Runs only against the local database, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.new_user(uid uuid) returns void language sql as $$
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
$$;

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- F: Free. P: Premium. M: no entitlement.
select pg_temp.new_user('11111111-1111-1111-1111-111111111111');
select pg_temp.new_user('33333333-3333-3333-3333-333333333333');
select pg_temp.new_user('55555555-5555-5555-5555-555555555555');
delete from public.user_entitlements where user_id = '55555555-5555-5555-5555-555555555555';

-- No authenticated user
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.get_monetization_status() $$, 'P0001', 'AUTH_REQUIRED', 'status requires an authenticated user');

-- Free account with 2 plants, one with a reminder
insert into public.plants (id, user_id, common_name) values
  ('11111111-1111-1111-1111-000000000001', '11111111-1111-1111-1111-111111111111', 'Test plant 1'),
  ('11111111-1111-1111-1111-000000000002', '11111111-1111-1111-1111-111111111111', 'Test plant 2');
insert into public.plant_reminders (user_id, plant_id, type, next_due_date)
values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-000000000001', 'watering', current_date + 1);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select is(public.get_monetization_status() ->> 'tier', 'free', 'Free account reports tier free');
select is((public.get_monetization_status() ->> 'available_credits')::int, 5, 'new Free account has 5 available credits');
select is((public.get_monetization_status() ->> 'garden_plant_limit')::int, 10, 'Free garden limit is 10');
select is((public.get_monetization_status() ->> 'reminder_plant_limit')::int, 3, 'Free reminder-plant limit is 3');
select is((public.get_monetization_status() ->> 'garden_plant_count')::int, 2, 'garden plant count is reported');
select is((public.get_monetization_status() ->> 'reminder_plant_count')::int, 1, 'reminder plant count is reported');
select is(public.get_monetization_status() ->> 'free_monthly_available', 'false', 'Free monthly credit is not available while welcome credits remain');

-- Free monthly credit shown as available once due
update public.ai_credit_balances
set included_credits = 0, welcome_exhausted_at = now() - interval '1 month 1 day'
where user_id = '11111111-1111-1111-1111-111111111111';
select is(public.get_monetization_status() ->> 'free_monthly_available', 'true', 'Free monthly credit is available once due');
select is((public.get_monetization_status() ->> 'available_credits')::int, 1, 'the due Free monthly credit counts as available');
update public.ai_credit_balances set purchased_credits = 3 where user_id = '11111111-1111-1111-1111-111111111111';
select is((public.get_monetization_status() ->> 'available_credits')::int, 4, 'purchased credits are added to available credits');

-- Premium: no limits, no Free monthly credit
update public.user_entitlements set tier = 'premium' where user_id = '33333333-3333-3333-3333-333333333333';
update public.ai_credit_balances
set included_credits = 0, welcome_exhausted_at = now() - interval '2 months'
where user_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select is(public.get_monetization_status() ->> 'garden_plant_limit', null, 'Premium has no garden limit');
select is(public.get_monetization_status() ->> 'reminder_plant_limit', null, 'Premium has no reminder-plant limit');
select is(public.get_monetization_status() ->> 'free_monthly_available', 'false', 'Premium never shows the Free monthly credit');

-- Missing monetization state
select pg_temp.act_as('55555555-5555-5555-5555-555555555555');
select throws_ok($$ select public.get_monetization_status() $$, 'P0001', 'MONETIZATION_STATE_MISSING', 'missing entitlement is reported');

-- Privileges and a real authenticated call
select ok(has_function_privilege('authenticated', 'public.get_monetization_status()', 'execute'), 'authenticated can execute get_monetization_status');
select ok(not has_function_privilege('anon', 'public.get_monetization_status()', 'execute'), 'anon cannot execute get_monetization_status');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;
select is(public.get_monetization_status() ->> 'tier', 'free', 'an authenticated user reads their own status');
reset role;

select * from finish();
rollback;
