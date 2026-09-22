-- ALMEO Monetization Foundation M4
-- Free accounts may configure reminders on up to 3 distinct plants.
-- Multiple reminder types on the same plant do not consume extra slots.
-- Premium is unlimited. Downgraded users keep and may edit their existing
-- reminder set; only increasing the number of distinct reminder plants is blocked.

create or replace function public.enforce_free_reminder_plant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_auth_uid uuid := auth.uid();
  v_current_count integer;
  v_prospective_count integer;
begin
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and new.plant_id = old.plant_id then
    return new;
  end if;

  if v_auth_uid is not null and v_auth_uid <> new.user_id then
    return new;
  end if;

  select tier
  into v_tier
  from public.user_entitlements
  where user_id = new.user_id
  for update;

  if not found then
    raise exception 'MONETIZATION_STATE_MISSING'
      using errcode = 'P0001';
  end if;

  if v_tier = 'premium' then
    return new;
  end if;

  select count(distinct plant_id)::integer
  into v_current_count
  from public.plant_reminders
  where user_id = new.user_id;

  if tg_op = 'INSERT' then
    select count(distinct plant_id)::integer
    into v_prospective_count
    from (
      select plant_id
      from public.plant_reminders
      where user_id = new.user_id
      union all
      select new.plant_id
    ) s;
  else
    select count(distinct plant_id)::integer
    into v_prospective_count
    from (
      select plant_id
      from public.plant_reminders
      where user_id = new.user_id
        and id <> old.id
      union all
      select new.plant_id
    ) s;
  end if;

  if v_prospective_count > greatest(v_current_count, 3) then
    raise exception 'FREE_REMINDER_PLANT_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_free_reminder_plant_limit() from public;
revoke all on function public.enforce_free_reminder_plant_limit() from anon;
revoke all on function public.enforce_free_reminder_plant_limit() from authenticated;

drop trigger if exists enforce_free_reminder_plant_limit on public.plant_reminders;
create trigger enforce_free_reminder_plant_limit
before insert or update on public.plant_reminders
for each row execute function public.enforce_free_reminder_plant_limit();
