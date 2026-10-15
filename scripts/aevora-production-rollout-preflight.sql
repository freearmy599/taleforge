\set ON_ERROR_STOP on
-- Read-only production preflight. Run as an authorized catalog reader.
-- Never select cron.job.command: it may contain credentials or bearer tokens.
BEGIN TRANSACTION READ ONLY;

SELECT
  'release_schedules.automation_ready_at' AS check_name,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'release_schedules'
      AND column_name = 'automation_ready_at'
  ) AS passed;

SELECT
  j.jobname,
  j.schedule,
  j.active,
  CASE
    WHEN j.command ILIKE '%generation-orchestrator%' THEN 'generation-orchestrator'
    WHEN j.command ILIKE '%release-scheduler%' THEN 'release-scheduler'
    WHEN j.command ILIKE '%autonomous-series-creation-runner%' THEN 'autonomous-series-creation-runner'
    ELSE 'other'
  END AS target,
  CASE
    WHEN j.command ~* 'dry_run[^;]{0,40}false' THEN 'explicit_false'
    WHEN j.command ~* 'dry_run[^;]{0,40}true' THEN 'explicit_true'
    WHEN j.command ILIKE '%dry_run%' THEN 'present_unresolved'
    ELSE 'not_specified_defaults_may_mutate'
  END AS dry_run_mode,
  count(d.jobid) FILTER (
    WHERE d.start_time >= now() - interval '24 hours' AND d.status = 'succeeded'
  ) AS succeeded_runs_24h,
  count(d.jobid) FILTER (
    WHERE d.start_time >= now() - interval '24 hours' AND d.status = 'failed'
  ) AS failed_runs_24h,
  max(d.start_time) AS latest_run_start,
  max(d.end_time) AS latest_run_end
FROM cron.job AS j
LEFT JOIN cron.job_run_details AS d ON d.jobid = j.jobid
WHERE j.command ILIKE '%generation-orchestrator%'
   OR j.command ILIKE '%release-scheduler%'
   OR j.command ILIKE '%autonomous-series-creation-runner%'
GROUP BY j.jobname, j.schedule, j.active, j.command
ORDER BY j.jobname;

SELECT
  count(*) AS total_schedules,
  count(*) FILTER (WHERE rs.enabled IS TRUE) AS enabled_schedules,
  count(*) FILTER (WHERE rs.enabled IS TRUE AND rs.auto_generate IS TRUE) AS enabled_generation_schedules,
  count(*) FILTER (WHERE rs.auto_publish IS TRUE) AS auto_publication_schedules,
  count(*) FILTER (
    WHERE rs.enabled IS TRUE
      AND rs.schedule_mode <> 'manual'
      AND coalesce(to_jsonb(rs)->>'automation_ready_at', '') = ''
  ) AS enabled_nonmanual_schedules_without_readiness,
  count(*) FILTER (
    WHERE rs.enabled IS TRUE AND rs.next_release_at < now()
  ) AS enabled_schedules_past_due,
  count(*) FILTER (
    WHERE s.status = 'ongoing'
      AND s.origin_type = 'ai_original'
      AND s.originality_status = 'pending'
  ) AS ongoing_ai_original_schedules_with_pending_originality,
  (SELECT count(*) FROM (
    SELECT series_id
    FROM public.release_schedules
    GROUP BY series_id
    HAVING count(*) > 1
  ) AS duplicate_schedule_series) AS series_with_multiple_schedules
FROM public.release_schedules AS rs
JOIN public.series AS s ON s.id = rs.series_id;

SELECT
  policy_key,
  enabled,
  max_total_production_series,
  max_unpublished_autonomous_series,
  max_autonomous_creations_per_7d,
  exclude_internal_test_series,
  updated_at
FROM public.taleforge_autonomous_creation_policy
WHERE policy_key = 'production';

SELECT
  status,
  dry_run,
  count(*) AS runs_7d,
  max(created_at) AS latest_run_at
FROM public.taleforge_autonomous_series_creation_runs
WHERE created_at >= now() - interval '7 days'
GROUP BY status, dry_run
ORDER BY status, dry_run;

COMMIT;
