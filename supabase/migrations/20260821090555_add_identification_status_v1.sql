alter table public.plants
  add column identification_status text null;

alter table public.plants
  add constraint plants_identification_status_check
    check (identification_status is null or identification_status in ('unreviewed','confirmed','rejected','uncertain'));;
