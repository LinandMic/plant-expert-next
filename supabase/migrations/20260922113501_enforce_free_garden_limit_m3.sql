-- ALMEO Monetization Foundation M3
-- Free accounts may keep up to 10 plants in My Garden; Premium is unlimited.
-- The trigger only blocks future INSERTs. It never removes plants if a user
-- later downgrades with more than 10 already present.

create or replace function public.enforce_free_garden_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_count integer;
  v_auth_uid uuid := auth.uid();
begin
  -- Never inspect another user's monetization state for a normal
  -- authenticated client. Let the existing plants RLS reject that write.
  if v_auth_uid is not null and v_auth_uid <> new.user_id then
    return new;
  end if;

  -- Serialize concurrent inserts for the same user before counting. This
  -- prevents two simultaneous 10th/11th inserts from both passing.
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

  select count(*)::integer
  into v_count
  from public.plants
  where user_id = new.user_id;

  if v_count >= 10 then
    raise exception 'FREE_GARDEN_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_free_garden_limit() from public;
revoke all on function public.enforce_free_garden_limit() from anon;
revoke all on function public.enforce_free_garden_limit() from authenticated;

drop trigger if exists enforce_free_garden_limit on public.plants;
create trigger enforce_free_garden_limit
before insert on public.plants
for each row execute function public.enforce_free_garden_limit();
