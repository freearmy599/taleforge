-- TaleForge Major + Minor Arc Design
-- Live deployment is authoritative. This migration documents the deployed arc-design-v1 layer.
-- Includes concept-level major/minor arc architecture, character/relationship links,
-- deterministic arc design and verification, and governance registration.
-- No prose generation and no canon mutation.
comment on table public.taleforge_story_concept_arcs is 'Concept-level major/minor arc architecture deployed as arc-design-v1.';
comment on table public.taleforge_story_concept_arc_characters is 'Character-to-arc causal assignments for concept architecture.';
comment on table public.taleforge_story_concept_arc_relationships is 'Relationship-to-arc causal assignments for concept architecture.';
comment on function public.taleforge_design_concept_arcs(uuid) is 'Builds deterministic major/minor arc architecture from an approved concept without prose generation or canon mutation.';
comment on function public.taleforge_verify_concept_arcs(uuid) is 'Verifies arc depth, parentage, character coverage and relationship coverage for a concept.';