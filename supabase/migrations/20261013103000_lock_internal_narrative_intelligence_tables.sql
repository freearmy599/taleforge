-- Internal narrative-engine state is not a reader-facing API.
-- Remove broad public SELECT policies and inherited client table grants.
-- No client-facing policies are added; service-role workers retain their existing access.
DROP POLICY IF EXISTS "public read continuity events" ON public.character_continuity_events;
DROP POLICY IF EXISTS "public read world continuity events" ON public.world_continuity_events;
DROP POLICY IF EXISTS "taleforge_cont_recon_findings_read" ON public.taleforge_continuity_reconciliation_findings;
DROP POLICY IF EXISTS "taleforge_cont_recon_runs_read" ON public.taleforge_continuity_reconciliation_runs;
DROP POLICY IF EXISTS "anon can read depth plans" ON public.taleforge_narrative_depth_plans;
DROP POLICY IF EXISTS "authenticated can read depth plans" ON public.taleforge_narrative_depth_plans;
DROP POLICY IF EXISTS "public can read narrative memory snapshots" ON public.taleforge_narrative_memory_snapshots;
DROP POLICY IF EXISTS "thread events are publicly readable" ON public.taleforge_narrative_thread_events;
DROP POLICY IF EXISTS "taleforge_thread_progression_read" ON public.taleforge_narrative_thread_progression;
DROP POLICY IF EXISTS "active narrative threads are publicly readable" ON public.taleforge_narrative_threads;
DROP POLICY IF EXISTS "public read novelty evaluations" ON public.taleforge_novelty_evaluations;
DROP POLICY IF EXISTS "public can read system dependencies" ON public.taleforge_system_dependencies;
DROP POLICY IF EXISTS "public can read system health" ON public.taleforge_system_health;
DROP POLICY IF EXISTS "public can read system registry" ON public.taleforge_system_registry;

REVOKE ALL PRIVILEGES ON TABLE
  public.character_continuity_events,
  public.world_continuity_events,
  public.taleforge_continuity_reconciliation_findings,
  public.taleforge_continuity_reconciliation_runs,
  public.taleforge_narrative_depth_plans,
  public.taleforge_narrative_memory_snapshots,
  public.taleforge_narrative_thread_events,
  public.taleforge_narrative_thread_progression,
  public.taleforge_narrative_threads,
  public.taleforge_novelty_evaluations,
  public.taleforge_system_dependencies,
  public.taleforge_system_health,
  public.taleforge_system_registry
FROM PUBLIC, anon, authenticated;
