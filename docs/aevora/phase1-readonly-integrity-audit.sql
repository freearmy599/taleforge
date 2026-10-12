-- Aevora Phase 1 publication-integrity audit
-- READ ONLY: SELECT statements only. Safe to run in the SQL editor without
-- changing schedules, chapters, review decisions, or provider state.
-- Findings require human review; this script never repairs or publishes data.

WITH published_slots AS (
  SELECT
    c.series_id,
    c.chapter_number,
    count(*)::integer AS row_count,
    array_agg(c.id::text ORDER BY c.id::text) AS chapter_ids
  FROM public.chapters c
  WHERE c.status = 'published'
  GROUP BY c.series_id, c.chapter_number
),
series_max AS (
  SELECT series_id, max(chapter_number)::integer AS max_chapter
  FROM published_slots
  GROUP BY series_id
),
chapter_gaps AS (
  SELECT
    s.id AS series_id,
    gs.chapter_number::integer AS chapter_number
  FROM series_max sm
  JOIN public.series s ON s.id = sm.series_id
  CROSS JOIN LATERAL generate_series(1, sm.max_chapter) AS gs(chapter_number)
  LEFT JOIN published_slots ps
    ON ps.series_id = sm.series_id
   AND ps.chapter_number = gs.chapter_number
  WHERE ps.series_id IS NULL
),
review_counts AS (
  SELECT
    r.generation_output_id,
    count(*)::integer AS review_count,
    bool_and(r.decision = 'approved'
      AND r.quality_passed IS TRUE
      AND r.continuity_passed IS TRUE
      AND r.originality_passed IS TRUE
      AND r.safety_passed IS TRUE) AS all_gates_passed,
    array_agg(r.id::text ORDER BY r.id::text) AS review_ids
  FROM public.chapter_publication_reviews r
  GROUP BY r.generation_output_id
),
findings AS (
  SELECT
    'published_chapter_gap'::text AS finding_type,
    g.series_id::text AS series_id,
    g.chapter_number,
    NULL::text AS output_id,
    jsonb_build_object('expected_chapter_number', g.chapter_number) AS details
  FROM chapter_gaps g

  UNION ALL

  SELECT
    'duplicate_published_chapter_slot',
    ps.series_id::text,
    ps.chapter_number,
    NULL::text,
    jsonb_build_object('row_count', ps.row_count, 'chapter_ids', ps.chapter_ids)
  FROM published_slots ps
  WHERE ps.row_count <> 1

  UNION ALL

  SELECT
    CASE
      WHEN coalesce(rc.review_count, 0) = 0 THEN 'approved_output_missing_publication_review'
      WHEN rc.review_count <> 1 THEN 'approved_output_has_nonunique_publication_reviews'
      ELSE 'approved_output_review_gate_not_fully_approved'
    END,
    o.series_id::text,
    o.chapter_number,
    o.id::text,
    jsonb_build_object(
      'generation_status', o.generation_status,
      'review_count', coalesce(rc.review_count, 0),
      'all_gates_passed', coalesce(rc.all_gates_passed, false),
      'review_ids', rc.review_ids
    )
  FROM public.chapter_generation_outputs o
  LEFT JOIN review_counts rc ON rc.generation_output_id = o.id
  WHERE o.generation_status = 'approved'
    AND (
      coalesce(rc.review_count, 0) <> 1
      OR rc.all_gates_passed IS DISTINCT FROM true
    )

  UNION ALL

  SELECT
    'enabled_auto_publish_schedule_overdue_over_24h',
    rs.series_id::text,
    NULL::integer,
    NULL::text,
    jsonb_build_object(
      'schedule_id', rs.id,
      'next_release_at', rs.next_release_at,
      'last_release_at', rs.last_release_at,
      'hours_overdue', round(extract(epoch FROM (clock_timestamp() - rs.next_release_at)) / 3600.0, 2)
    )
  FROM public.release_schedules rs
  WHERE rs.enabled IS TRUE
    AND rs.auto_publish IS TRUE
    AND rs.next_release_at IS NOT NULL
    AND rs.next_release_at < clock_timestamp() - interval '24 hours'
)
SELECT finding_type, series_id, chapter_number, output_id, details
FROM findings
ORDER BY finding_type, series_id, chapter_number NULLS LAST, output_id NULLS LAST;
