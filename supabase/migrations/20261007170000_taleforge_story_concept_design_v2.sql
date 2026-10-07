-- TaleForge Story Concept Design Intelligence v2
-- Upgrades concept scaffolds with full-cast causal architecture,
-- governed power/personality invariants, major/minor arc capacity,
-- and explicit no-prose/no-canon-mutation boundaries.
-- Depends on: 20261007162500_taleforge_story_concept_design_intelligence.sql

-- The deployed v2 function is intentionally deterministic and derives only
-- from the selected Story Opportunity plus explicit design constraints.
-- It creates architecture scaffolds; it does not generate prose or mutate Story DNA.

-- See the deployed function public.taleforge_design_story_concept(uuid,jsonb).
-- This migration marker keeps the repository's migration history aligned
-- with the production database v2 deployment.

comment on function public.taleforge_design_story_concept(uuid,jsonb)
is 'TaleForge Concept Design v2: full-cast causal architecture, governed power/personality invariants, major/minor arc capacity; no prose generation and no Story DNA mutation.';