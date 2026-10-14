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
  WITH recent_events AS (
    SELECT
      re.id,
      re.visitor_id,
      re.series_id,
      re.chapter_id,
      re.event_type,
      re.progress_percent,
      re.created_at,
      EXTRACT(epoch FROM pg_catalog.now() - re.created_at) / 86400.0 AS age_days
    FROM public.reader_events AS re
    WHERE re.series_id IS NOT NULL
      AND re.created_at > pg_catalog.now() - interval '30 days'
      AND re.created_at <= pg_catalog.now()
  ),
  latest_follow_state AS (
    SELECT DISTINCT ON (re.visitor_id, re.series_id)
      re.visitor_id, re.series_id, re.event_type, re.created_at
    FROM public.reader_events AS re
    WHERE re.series_id IS NOT NULL
      AND re.event_type IN ('follow', 'unfollow')
      AND re.created_at <= pg_catalog.now()
    ORDER BY re.visitor_id, re.series_id, re.created_at DESC, re.id DESC
  ),
  latest_bookmark_state AS (
    SELECT DISTINCT ON (re.visitor_id, re.chapter_id)
      re.visitor_id, re.series_id, re.chapter_id, re.event_type, re.created_at
    FROM public.reader_events AS re
    JOIN public.chapters AS c
      ON c.id = re.chapter_id
     AND c.series_id = re.series_id
     AND c.status = 'published'
    JOIN public.series AS eligible_series
      ON eligible_series.id = re.series_id
     AND eligible_series.status IN ('ongoing', 'completed')
    WHERE re.chapter_id IS NOT NULL
      AND re.event_type IN ('bookmark', 'unbookmark')
      AND re.created_at <= pg_catalog.now()
    ORDER BY re.visitor_id, re.chapter_id, re.created_at DESC, re.id DESC
  ),
  scored_events AS (
    SELECT
      e.series_id,
      sum(
        CASE e.event_type
          WHEN 'story_open' THEN 1.0
          WHEN 'chapter_start' THEN 2.0
          WHEN 'reading_progress' THEN coalesce(e.progress_percent::integer, 0)::numeric / 50.0
          WHEN 'chapter_complete' THEN 5.0
          ELSE 0.0
        END * exp((-e.age_days) / 7.0)
      ) AS engagement_score,
      count(*) FILTER (WHERE e.event_type = 'story_open') AS opens,
      count(*) FILTER (WHERE e.event_type = 'chapter_complete') AS completions,
      max(e.created_at) AS latest_activity
    FROM recent_events AS e
    GROUP BY e.series_id
  ),
  follow_state_scores AS (
    SELECT
      f.series_id,
      sum(
        CASE WHEN f.event_type = 'follow'
                   AND f.created_at > pg_catalog.now() - interval '30 days'
             THEN 8.0 * exp(
               -(EXTRACT(epoch FROM pg_catalog.now() - f.created_at) / 86400.0) / 7.0
             )
             ELSE 0.0
        END
      ) AS engagement_score,
      count(*) FILTER (WHERE f.event_type = 'follow') AS follows,
      max(f.created_at) FILTER (
        WHERE f.created_at > pg_catalog.now() - interval '30 days'
      ) AS latest_activity
    FROM latest_follow_state AS f
    GROUP BY f.series_id
  ),
  bookmark_state_scores AS (
    SELECT
      c.series_id,
      sum(
        CASE WHEN b.event_type = 'bookmark'
                   AND b.created_at > pg_catalog.now() - interval '30 days'
             THEN 6.0 * exp(
               -(EXTRACT(epoch FROM pg_catalog.now() - b.created_at) / 86400.0) / 7.0
             )
             ELSE 0.0
        END
      ) AS engagement_score,
      count(*) FILTER (WHERE b.event_type = 'bookmark') AS bookmarks,
      max(b.created_at) FILTER (
        WHERE b.created_at > pg_catalog.now() - interval '30 days'
      ) AS latest_activity
    FROM latest_bookmark_state AS b
    JOIN public.chapters AS c
      ON c.id = b.chapter_id
     AND c.series_id = b.series_id
     AND c.status = 'published'
    GROUP BY c.series_id
  )
  SELECT
    s.id AS series_id,
    s.title,
    s.subtitle,
    s.description,
    s.status,
    s.published_at,
    coalesce(se.engagement_score, 0::numeric)
      + coalesce(fs.engagement_score, 0::numeric)
      + coalesce(bs.engagement_score, 0::numeric) AS trending_score,
    coalesce(se.opens, 0::bigint) AS opens,
    coalesce(se.completions, 0::bigint) AS completions,
    coalesce(fs.follows, 0::bigint) AS follows,
    coalesce(bs.bookmarks, 0::bigint) AS bookmarks,
    greatest(se.latest_activity, fs.latest_activity, bs.latest_activity) AS latest_activity
  FROM public.series AS s
  LEFT JOIN scored_events AS se ON se.series_id = s.id
  LEFT JOIN follow_state_scores AS fs ON fs.series_id = s.id
  LEFT JOIN bookmark_state_scores AS bs ON bs.series_id = s.id
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
