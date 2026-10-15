-- Branch-only public reader-event intake boundary.
-- The quota key is a hash of the browser's anonymous visitor hint, not verified identity.
BEGIN;

CREATE SCHEMA IF NOT EXISTS aevora_private;
REVOKE ALL ON SCHEMA aevora_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS aevora_private.reader_event_quota_buckets (
  visitor_key_hash text NOT NULL,
  quota_scope text NOT NULL DEFAULT '*'
    CHECK (quota_scope IN ('*','story_open','chapter_start','reading_progress','chapter_complete','follow','unfollow','bookmark','unbookmark')),
  window_kind text NOT NULL CHECK (window_kind IN ('minute', 'day')),
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count >= 0),
  PRIMARY KEY (visitor_key_hash, quota_scope, window_kind, window_start)
);
REVOKE ALL ON TABLE aevora_private.reader_event_quota_buckets FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS reader_event_quota_buckets_expiry_idx
  ON aevora_private.reader_event_quota_buckets (window_start);

-- Prevent cleanup work from running on every incoming event. One caller per
-- minute may claim this gate; each cleanup still deletes at most 1000 rows.
CREATE TABLE IF NOT EXISTS aevora_private.reader_event_quota_cleanup_state (
  singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
  last_cleaned_at timestamptz NOT NULL DEFAULT '-infinity'
);
REVOKE ALL ON TABLE aevora_private.reader_event_quota_cleanup_state FROM PUBLIC, anon, authenticated;
INSERT INTO aevora_private.reader_event_quota_cleanup_state(singleton_id)
VALUES (1) ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.aevora_ingest_reader_event(
  p_visitor_id text,
  p_event_uuid uuid,
  p_event_type text,
  p_series_id uuid,
  p_chapter_id uuid DEFAULT NULL,
  p_progress_percent integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aevora_private
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_visitor_hash text;
  v_minute timestamptz;
  v_day timestamptz;
  v_hits integer;
  v_event_daily_hits integer;
  v_inserted_id bigint;
BEGIN
  IF p_visitor_id IS NULL OR length(p_visitor_id) < 16 OR length(p_visitor_id) > 100
     OR p_event_type IS NULL OR p_event_type NOT IN ('story_open','chapter_start','reading_progress','chapter_complete','follow','unfollow','bookmark','unbookmark')
     OR p_series_id IS NULL
     OR (p_progress_percent IS NOT NULL AND (p_progress_percent < 0 OR p_progress_percent > 100))
     OR (p_event_type = 'reading_progress' AND p_progress_percent IS NULL)
     OR (p_event_type <> 'reading_progress' AND p_progress_percent IS NOT NULL) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.series s
    WHERE s.id = p_series_id AND s.status IN ('ongoing','completed')
  ) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  IF p_chapter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chapters c
    JOIN public.series s ON s.id = c.series_id
    WHERE c.id = p_chapter_id AND c.series_id = p_series_id
      AND c.status = 'published' AND s.status IN ('ongoing','completed')
  ) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF p_event_uuid IS NOT NULL THEN
    -- Serialize the same idempotency key across different visitor hints too,
    -- so a concurrent duplicate does not consume another visitor's quota.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_event_uuid::text, 7918)
    );
    IF EXISTS (
      SELECT 1 FROM public.reader_events e WHERE e.event_uuid = p_event_uuid
    ) THEN
      RETURN jsonb_build_object('outcome', 'duplicate');
    END IF;
  END IF;

  -- Bounded opportunistic cleanup runs on each valid request. The indexed
  -- delete below removes at most 1000 expired rows per invocation.
  PERFORM public.aevora_prune_reader_event_quota_buckets();

  v_visitor_hash := md5(p_visitor_id);
  v_minute := date_trunc('minute', v_now);
  v_day := date_trunc('day', v_now);

  -- Serialize this visitor's quota decisions so the check-and-increment
  -- below is atomic across concurrent requests for the same visitor hint.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_visitor_hash, 7919));

  -- Check every applicable bucket before mutating any of them. A rejected
  -- request must not consume the global budget and starve other event types.
  SELECT hit_count INTO v_hits
  FROM aevora_private.reader_event_quota_buckets
  WHERE visitor_key_hash = v_visitor_hash
    AND quota_scope = '*' AND window_kind = 'minute' AND window_start = v_minute;
  IF COALESCE(v_hits, 0) >= 30 THEN
    RETURN jsonb_build_object('outcome', 'limited');
  END IF;

  SELECT hit_count INTO v_hits
  FROM aevora_private.reader_event_quota_buckets
  WHERE visitor_key_hash = v_visitor_hash
    AND quota_scope = '*' AND window_kind = 'day' AND window_start = v_day;
  IF COALESCE(v_hits, 0) >= 1000 THEN
    RETURN jsonb_build_object('outcome', 'limited');
  END IF;

  SELECT hit_count INTO v_event_daily_hits
  FROM aevora_private.reader_event_quota_buckets
  WHERE visitor_key_hash = v_visitor_hash
    AND quota_scope = p_event_type AND window_kind = 'day' AND window_start = v_day;
  IF COALESCE(v_event_daily_hits, 0) >= 250 THEN
    RETURN jsonb_build_object('outcome', 'limited');
  END IF;

  INSERT INTO aevora_private.reader_event_quota_buckets(visitor_key_hash, quota_scope, window_kind, window_start, hit_count)
  VALUES (v_visitor_hash, '*', 'minute', v_minute, 1)
  ON CONFLICT (visitor_key_hash, quota_scope, window_kind, window_start)
  DO UPDATE SET hit_count = aevora_private.reader_event_quota_buckets.hit_count + 1
  RETURNING hit_count INTO v_hits;

  INSERT INTO aevora_private.reader_event_quota_buckets(visitor_key_hash, quota_scope, window_kind, window_start, hit_count)
  VALUES (v_visitor_hash, '*', 'day', v_day, 1)
  ON CONFLICT (visitor_key_hash, quota_scope, window_kind, window_start)
  DO UPDATE SET hit_count = aevora_private.reader_event_quota_buckets.hit_count + 1
  RETURNING hit_count INTO v_hits;

  INSERT INTO aevora_private.reader_event_quota_buckets(visitor_key_hash, quota_scope, window_kind, window_start, hit_count)
  VALUES (v_visitor_hash, p_event_type, 'day', v_day, 1)
  ON CONFLICT (visitor_key_hash, quota_scope, window_kind, window_start)
  DO UPDATE SET hit_count = aevora_private.reader_event_quota_buckets.hit_count + 1
  RETURNING hit_count INTO v_event_daily_hits;

  INSERT INTO public.reader_events(visitor_id, event_type, series_id, chapter_id, progress_percent, event_uuid)
  VALUES (p_visitor_id, p_event_type, p_series_id, p_chapter_id, p_progress_percent, p_event_uuid)
  ON CONFLICT (event_uuid) WHERE event_uuid IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  RETURN jsonb_build_object('outcome', 'accepted');
END;
$function$;

REVOKE ALL ON FUNCTION public.aevora_ingest_reader_event(text, uuid, text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_ingest_reader_event(text, uuid, text, uuid, uuid, integer) TO service_role;

-- Remove expired buckets during subsequent calls without retaining raw visitor IDs.
CREATE OR REPLACE FUNCTION public.aevora_prune_reader_event_quota_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aevora_private
AS $function$
DECLARE
  v_deleted integer := 0;
  v_now timestamptz := statement_timestamp();
BEGIN
  -- The read is cheap on every request. Only a request that observes an
  -- expired cleanup window tries the non-blocking global lock.
  IF NOT EXISTS (
    SELECT 1
    FROM aevora_private.reader_event_quota_cleanup_state
    WHERE singleton_id = 1
      AND last_cleaned_at <= v_now - interval '1 minute'
  ) THEN
    RETURN 0;
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(19017, 811) THEN
    RETURN 0;
  END IF;

  UPDATE aevora_private.reader_event_quota_cleanup_state
  SET last_cleaned_at = v_now
  WHERE singleton_id = 1
    AND last_cleaned_at <= v_now - interval '1 minute';
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH expired AS (
    SELECT ctid
    FROM aevora_private.reader_event_quota_buckets
    WHERE window_start < v_now - interval '2 days'
    ORDER BY window_start
    LIMIT 1000
  )
  DELETE FROM aevora_private.reader_event_quota_buckets q
  USING expired
  WHERE q.ctid = expired.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.aevora_prune_reader_event_quota_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_prune_reader_event_quota_buckets() TO service_role;

COMMIT;
