\set ON_ERROR_STOP on

-- Seed follow/bookmark state transitions through a trusted server role.
-- The aggregate must count only the latest state, not every positive event.
SET ROLE service_role;
INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id,created_at)
VALUES
  ('visitor-state-off-0001','follow',
   '00000000-0000-0000-0000-000000000101',NULL,statement_timestamp() - interval '3 hours'),
  ('visitor-state-off-0001','unfollow',
   '00000000-0000-0000-0000-000000000101',NULL,statement_timestamp() - interval '2 hours'),
  ('visitor-state-on-0001','follow',
   '00000000-0000-0000-0000-000000000101',NULL,statement_timestamp() - interval '1 hour'),
  ('visitor-state-off-0001','bookmark',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000111',statement_timestamp() - interval '3 hours'),
  ('visitor-state-off-0001','unbookmark',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000111',statement_timestamp() - interval '2 hours'),
  ('visitor-state-on-0001','bookmark',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000111',statement_timestamp() - interval '1 hour'),
  ('visitor-future-event-0001','story_open',
   '00000000-0000-0000-0000-000000000101',NULL,'2099-01-01 00:00:00+00');
RESET ROLE;

DO $trending_state_assert$
DECLARE
  v_follows bigint;
  v_bookmarks bigint;
  v_opens bigint;
  v_score numeric;
BEGIN
  SELECT t.follows, t.bookmarks, t.opens, t.trending_score
  INTO v_follows, v_bookmarks, v_opens, v_score
  FROM public.get_public_story_trending_scores() AS t
  WHERE t.series_id = '00000000-0000-0000-0000-000000000101';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: eligible series missing from trending aggregate';
  END IF;
  IF v_follows <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: follow state should count one active follow, got %', v_follows;
  END IF;
  IF v_bookmarks <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: bookmark state should count one active bookmark, got %', v_bookmarks;
  END IF;
  IF v_opens <> 4 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: future-dated and old opens must not count; expected 4 recent opens, got %', v_opens;
  END IF;
  IF v_score <= 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: recent valid engagement should produce a positive score';
  END IF;
END;
$trending_state_assert$;

-- The view remains a read API and must not expose raw event rows.
DO $trending_acl_assert$
BEGIN
  IF NOT has_table_privilege('anon','public.story_trending_scores','SELECT')
     OR has_table_privilege('anon','public.story_trending_scores','INSERT')
     OR has_table_privilege('authenticated','public.story_trending_scores','UPDATE')
     OR has_table_privilege('anon','public.reader_events','SELECT')
     OR has_table_privilege('authenticated','public.reader_events','SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: trending view/raw-event ACL contract failed';
  END IF;
END;
$trending_acl_assert$;

SELECT 'trending state and future-event assertions passed' AS result;
