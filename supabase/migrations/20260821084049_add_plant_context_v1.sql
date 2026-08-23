alter table public.plants
  add column if not exists location text null,
  add column if not exists exposure text null,
  add column if not exists orientation text null,
  add column if not exists watering_mode text null,
  add column if not exists watering_type text null,
  add column if not exists watering_frequency_days integer null,
  add column if not exists watering_duration_minutes integer null,
  add column if not exists watering_flow_lph numeric null,
  add column if not exists watering_emitter_count integer null;

alter table public.plants
  add constraint plants_exposure_check
    check (exposure is null or exposure in ('full_sun','partial_sun','bright_shade','shade','unknown')),
  add constraint plants_orientation_check
    check (orientation is null or orientation in ('n','ne','e','se','s','sw','w','nw','unknown')),
  add constraint plants_watering_mode_check
    check (watering_mode is null or watering_mode in ('manual','automatic')),
  add constraint plants_watering_type_check
    check (watering_type is null or watering_type in ('drip','micro_sprinkler','sprinkler','soaker_hose','other')),
  add constraint plants_watering_frequency_days_check
    check (watering_frequency_days is null or watering_frequency_days > 0),
  add constraint plants_watering_duration_minutes_check
    check (watering_duration_minutes is null or watering_duration_minutes > 0),
  add constraint plants_watering_flow_lph_check
    check (watering_flow_lph is null or watering_flow_lph > 0),
  add constraint plants_watering_emitter_count_check
    check (watering_emitter_count is null or watering_emitter_count > 0),
  add constraint plants_manual_watering_fields_null_check
    check (
      watering_mode = 'automatic'
      or (
        watering_type is null
        and watering_frequency_days is null
        and watering_duration_minutes is null
        and watering_flow_lph is null
        and watering_emitter_count is null
      )
    );;
