-- Expose only per-series engagement aggregates to the public discovery views.
-- The raw reader_events table remains INSERT-only for ordinary clients; it does not
-- gain a SELECT policy. The function is fixed SQL with no parameters, uses a fixed
-- search_path, and returns only public series metadata plus aggregated event counts.
-- This is a branch-only proposal; do not apply to production without security review.
CREATE OR REPLACE FUNCTION public.get_public_story_trending_scores()
RETURNS TABLE (
  series_id uuid,
  title text,
  subtitle text,
  description text,
  status text,
  published_at timestamptz,
  trending_score numeric,
  opens bigint,
  completions bigint,
  follows bigint,
  bookmarks bigint,
  latest_activity timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH events AS (
    SELECT
      re.series_id,
      re.event_type,
      re.progress_percent,
      re.created_at,
      EXTRACT(epoch FROM pg_catalog.now() - re.created_at) / 86400.0 AS age_days
    FROM public.reader_events AS re
    WHERE re.series_id IS NOT NULL
      AND re.created_at > pg_catalog.now() - interval '30 days'
  ),
  scored AS (
    SELECT
      e.series_id,
      sum(
        CASE e.event_type
          WHEN 'story_open' THEN 1.0
          WHEN 'chapter_start' THEN 2.0
          WHEN 'reading_progress' THEN coalesce(e.progress_percent::integer, 0)::numeric / 50.0
          WHEN 'chapter_complete' THEN 5.0
          WHEN 'follow' THEN 8.0
          WHEN 'bookmark' THEN 6.0
          ELSE 0.0
        END * exp((-e.age_days) / 7.0)
      ) AS engagement_score,
      count(*) FILTER (WHERE e.event_type = 'story_open') AS opens,
      count(*) FILTER (WHERE e.event_type = 'chapter_complete') AS completions,
      count(*) FILTER (WHERE e.event_type = 'follow') AS follows,
      count(*) FILTER (WHERE e.event_type = 'bookmark') AS bookmarks,
      max(e.created_at) AS latest_activity
    FROM events AS e
    GROUP BY e.series_id
  )
  SELECT
    s.id AS series_id,
    s.title,
    s.subtitle,
    s.description,
    s.status,
    s.published_at,
    coalesce(sc.engagement_score, 0::numeric) AS trending_score,
    coalesce(sc.opens, 0::bigint) AS opens,
    coalesce(sc.completions, 0::bigint) AS completions,
    coalesce(sc.follows, 0::bigint) AS follows,
    coalesce(sc.bookmarks, 0::bigint) AS bookmarks,
    sc.latest_activity
  FROM public.series AS s
  LEFT JOIN scored AS sc ON sc.series_id = s.id
  WHERE s.status = ANY (ARRAY['ongoing'::text, 'completed'::text]);
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_public_story_trending_scores() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_story_trending_scores() TO anon, authenticated, service_role;

-- Keep the existing public-view contract and security_invoker behavior. The
-- allowlisted definer function is the only path that can aggregate raw events.
CREATE OR REPLACE VIEW public.story_trending_scores
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_story_trending_scores();

-- These discovery views are read APIs only; remove default write/table-level
-- privileges while preserving public SELECT for the intended reader experience.
REVOKE ALL PRIVILEGES ON TABLE public.story_trending_scores, public.story_intelligence
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.story_trending_scores, public.story_intelligence
TO anon, authenticated;
