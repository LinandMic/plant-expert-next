create index plant_taxa_parent_taxon_id_idx
  on public.plant_taxa (parent_taxon_id);

create index plant_trait_observations_source_record_fk_idx
  on public.plant_trait_observations (
    plant_source_record_id,
    plant_catalog_id,
    provider
  );

create index plant_trait_selections_decided_by_idx
  on public.plant_trait_selections (decided_by);

create index plant_trait_selections_observation_fk_idx
  on public.plant_trait_selections (
    selected_observation_id,
    plant_catalog_id,
    trait
  );
