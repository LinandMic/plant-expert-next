-- Adds explicit image provenance fields to plant_catalog — additive only:
-- no column dropped or renamed, no existing row rewritten, no data
-- inserted by this migration. image_url stays nullable indefinitely: a
-- plant without a real, licensed photo must never block publication or
-- display (the Plant Finder UI already falls back to a sober placeholder
-- when it is null). No AI-generated image and no invented URL is ever
-- written to these columns, by this migration or any future automated
-- step — every value must trace back to a real, attributable source.
alter table public.plant_catalog
  add column image_url text null,
  add column image_alt text null,
  add column image_author text null,
  add column image_license text null,
  add column image_source_url text null;

comment on column public.plant_catalog.image_url is
  'Public URL of the plant''s primary catalog image. Nullable — a missing image never blocks publication or display; the UI falls back to a sober placeholder.';
comment on column public.plant_catalog.image_alt is
  'Accessible alt text for image_url. Never auto-derived from display_name — set explicitly alongside the image.';
comment on column public.plant_catalog.image_author is
  'Photographer/creator credit for image_url, for attribution display.';
comment on column public.plant_catalog.image_license is
  'License or usage terms for image_url (e.g. CC BY-SA 4.0) — kept for provenance/attribution, never inferred.';
comment on column public.plant_catalog.image_source_url is
  'Original source page for image_url (e.g. a Wikimedia Commons file page), for attribution linking.';
