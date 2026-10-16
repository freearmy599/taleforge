\\set ON_ERROR_STOP on
-- Read-only evidence collection for the six legacy schedule disposition slots.
-- Run only through an already-authorized read-only SQL session.
-- Output contains internal schedule/series identifiers and titles; retain it
-- in the approved access-controlled audit location, never a public report.
BEGIN TRANSACTION READ ONLY;

SELECT
  rs.id AS schedule_id,
  rs.series_id,
  s.title AS series_title,
  s.status AS series_status,
  s.origin_type,
  s.originality_status,
  rs.schedule_mode,
  rs.interval_hours,
  rs.preferred_weekday,
  rs.preferred_time,
  rs.timezone,
  rs.enabled,
  rs.auto_generate,
  rs.auto_publish,
  rs.automation_ready_at,
  rs.next_release_at,
  rs.created_at AS schedule_created_at,
  rs.updated_at AS schedule_updated_at,
  count(*) OVER (PARTITION BY rs.series_id) AS schedules_for_series
FROM public.release_schedules AS rs
JOIN public.series AS s ON s.id = rs.series_id
WHERE s.status = 'ongoing'
  AND s.origin_type = 'ai_original'
  AND s.originality_status = 'pending'
ORDER BY rs.created_at, rs.id;

COMMIT;
