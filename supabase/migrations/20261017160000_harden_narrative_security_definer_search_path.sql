-- Aevora Phase 1: keep temporary schemas behind public for reviewed
-- SECURITY DEFINER routines that currently resolve persistent relations unqualified.
-- This migration changes function-local search_path only; it does not change grants,
-- function bodies, triggers, publication state, schedules, or existing data.

ALTER FUNCTION public.taleforge_reassess_long_term_narrative_architecture(uuid)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.taleforge_refresh_long_term_narrative_architecture(uuid)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.taleforge_consolidate_narrative_memory(uuid, integer)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.taleforge_verify_narrative_memory_consolidation()
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.taleforge_verify_plot_thread_progression()
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.taleforge_refresh_narrative_memory_consolidation_health()
  SET search_path = pg_catalog, public, pg_temp;
