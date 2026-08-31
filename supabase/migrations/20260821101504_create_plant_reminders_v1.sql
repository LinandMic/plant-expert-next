create table public.plant_reminders (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  plant_id                  uuid not null,
  type                      text not null,
  is_active                 boolean not null default true,
  status                    text not null default 'pending',
  recurrence_type           text not null default 'none',
  recurrence_interval_days  integer null,
  next_due_date             date not null,
  last_completed_at         timestamptz null,
  note                      text null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint plant_reminders_plant_user_fk
    foreign key (plant_id, user_id) references public.plants (id, user_id) on delete cascade,

  constraint plant_reminders_type_check
    check (type in ('watering','pruning','repotting','fertilizing','pest_check','general_care')),

  constraint plant_reminders_status_check
    check (status in ('pending','done','snoozed','skipped')),

  constraint plant_reminders_recurrence_type_check
    check (recurrence_type in ('none','interval_days')),

  constraint plant_reminders_recurrence_consistency_check
    check (
      (recurrence_type = 'none'          and recurrence_interval_days is null)
      or
      (recurrence_type = 'interval_days' and recurrence_interval_days is not null and recurrence_interval_days > 0)
    ),

  constraint plant_reminders_terminal_status_check
    check (
      status not in ('done','skipped')
      or is_active = false
    ),

  constraint plant_reminders_unique_type unique (plant_id, type)
);

create index plant_reminders_user_due_idx
  on public.plant_reminders (user_id, next_due_date)
  where is_active and status in ('pending','snoozed');

alter table public.plant_reminders enable row level security;

create policy plant_reminders_select on public.plant_reminders
  for select using ((select auth.uid()) = user_id);

create policy plant_reminders_insert on public.plant_reminders
  for insert with check ((select auth.uid()) = user_id);

create policy plant_reminders_update on public.plant_reminders
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy plant_reminders_delete on public.plant_reminders
  for delete using ((select auth.uid()) = user_id);

revoke all on table public.plant_reminders from public, anon, authenticated;

grant select, insert, update, delete
  on table public.plant_reminders
  to authenticated;

create trigger set_plant_reminders_updated_at
  before update on public.plant_reminders
  for each row execute function public.set_updated_at();;
