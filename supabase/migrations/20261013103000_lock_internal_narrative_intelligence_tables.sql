-- Internal narrative-engine state is not a reader-facing API.
-- Remove broad public SELECT policies and inherited client table grants.
-- No client-facing policies are added; service-role workers retain their existing access.
ALTER TABLE
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
ENABLE ROW LEVEL SECURITY;

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

-- The invoker-security status view includes internal blocking_reason/evidence fields.
-- Disable direct client access until a separately reviewed allowlisted public projection exists.
REVOKE ALL PRIVILEGES ON TABLE public.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated;

-- The view can carry independent column-level SELECT grants. Revoke those too;
-- a relation-level REVOKE alone does not remove per-column privileges.
DO $$
DECLARE
  column_list text;
BEGIN
  IF to_regclass('public.taleforge_system_health_snapshot') IS NOT NULL THEN
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
      INTO column_list
    FROM pg_attribute
    WHERE attrelid = to_regclass('public.taleforge_system_health_snapshot')
      AND attnum > 0
      AND NOT attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated',
        column_list
      );
    END IF;
  END IF;
END
$$;

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

-- Relation-level REVOKE does not clear separately granted column privileges.
DO $$
DECLARE
  table_name text;
  column_list text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'character_continuity_events',
    'world_continuity_events',
    'taleforge_continuity_reconciliation_findings',
    'taleforge_continuity_reconciliation_runs',
    'taleforge_narrative_depth_plans',
    'taleforge_narrative_memory_snapshots',
    'taleforge_narrative_thread_events',
    'taleforge_narrative_thread_progression',
    'taleforge_narrative_threads',
    'taleforge_novelty_evaluations',
    'taleforge_system_dependencies',
    'taleforge_system_health',
    'taleforge_system_registry'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
        INTO column_list
      FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', table_name))
        AND attnum > 0
        AND NOT attisdropped;

      IF column_list IS NOT NULL THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
          column_list,
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END
$$;
