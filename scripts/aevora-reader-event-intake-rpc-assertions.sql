\set ON_ERROR_STOP on

DO $rpc_acl_assert$
BEGIN
  IF has_function_privilege('anon', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: reader-event RPC execution grants are not server-only';
  END IF;
  IF has_schema_privilege('anon','aevora_private','USAGE')
     OR has_schema_privilege('authenticated','aevora_private','USAGE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','SELECT')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','SELECT')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','INSERT')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','SELECT')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','SELECT')
     OR has_function_privilege('anon','public.aevora_prune_reader_event_quota_buckets()','EXECUTE')
     OR has_function_privilege('authenticated','public.aevora_prune_reader_event_quota_buckets()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.aevora_prune_reader_event_quota_buckets()','EXECUTE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','UPDATE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','DELETE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','TRUNCATE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','REFERENCES')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','TRIGGER')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','INSERT')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','UPDATE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','DELETE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','TRUNCATE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','REFERENCES')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','TRIGGER')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','INSERT')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','UPDATE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','DELETE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','TRUNCATE')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','REFERENCES')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_cleanup_state','TRIGGER')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','INSERT')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','UPDATE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','DELETE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','TRUNCATE')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','REFERENCES')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_cleanup_state','TRIGGER') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: public role can access private reader-event quota store or cleanup state, or execute cleanup RPC';
  END IF;
END;
$rpc_acl_assert$;

-- SECURITY DEFINER entry points and their backing state must not be owned by client roles.
DO $rpc_owner_assert$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('aevora_ingest_reader_event', 'aevora_prune_reader_event_quota_buckets')
      AND pg_catalog.pg_get_userbyid(p.proowner) IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: reader-event SECURITY DEFINER RPC is owned by a client role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'aevora_private'
      AND c.relname IN ('reader_event_quota_buckets', 'reader_event_quota_cleanup_state')
      AND pg_catalog.pg_get_userbyid(c.relowner) IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: private reader-event quota state is owned by a client role';
  END IF;
END;
$rpc_owner_assert$;

DO $cleanup_cooldown_assert$
DECLARE
  v_before timestamptz;
  v_after timestamptz;
  v_first_pruned integer;
  v_second_pruned integer;
BEGIN
  SELECT last_cleaned_at INTO v_before
  FROM aevora_private.reader_event_quota_cleanup_state
  WHERE singleton_id = 1;
  v_first_pruned := public.aevora_prune_reader_event_quota_buckets();
  SELECT last_cleaned_at INTO v_after
  FROM aevora_private.reader_event_quota_cleanup_state
  WHERE singleton_id = 1;
  IF v_first_pruned <> 0 OR v_after <= v_before THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: first cleanup claim did not advance the cleanup gate';
  END IF;
  v_second_pruned := public.aevora_prune_reader_event_quota_buckets();
  IF v_second_pruned <> 0 OR (SELECT last_cleaned_at
                              FROM aevora_private.reader_event_quota_cleanup_state
                              WHERE singleton_id = 1) <> v_after THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: quota cleanup ran again inside the one-minute cooldown';
  END IF;
END;
$cleanup_cooldown_assert$;

SET ROLE service_role;
DO $rpc_behavior_assert$
DECLARE
  v_result jsonb;
  i integer;
  v_accepted integer := 0;
  v_limited integer := 0;
BEGIN
  v_result := public.aevora_ingest_reader_event(
    'reader-rpc-behavior-visitor-0001',
    '20000000-0000-0000-0000-000000000001',
    'story_open',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000111',
    NULL
  );
  IF v_result->>'outcome' <> 'accepted' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: valid reader-event RPC call was not accepted: %', v_result->>'outcome';
  END IF;

  v_result := public.aevora_ingest_reader_event(
    'reader-rpc-behavior-visitor-0001',
    '20000000-0000-0000-0000-000000000001',
    'story_open',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000111',
    NULL
  );
  IF v_result->>'outcome' <> 'duplicate' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: repeated reader-event UUID was not idempotent';
  END IF;
  -- If the duplicate had consumed quota, this same visitor would have room
  -- for only 28 more events in the current 30/minute window, not 29.
  FOR i IN 1..29 LOOP
    v_result := public.aevora_ingest_reader_event(
      'reader-rpc-behavior-visitor-0001',
      ('60000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'story_open',
      '00000000-0000-0000-0000-000000000101',
      NULL,
      NULL
    );
    IF v_result->>'outcome' = 'accepted' THEN v_accepted := v_accepted + 1; END IF;
    IF v_result->>'outcome' = 'limited' THEN v_limited := v_limited + 1; END IF;
  END LOOP;
  IF v_accepted <> 29 OR v_limited <> 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: duplicate event consumed quota; expected 29 additional accepted events, got % accepted/% limited', v_accepted, v_limited;
  END IF;
  v_result := public.aevora_ingest_reader_event(
    'reader-rpc-behavior-visitor-0001',
    '60000000-0000-0000-0000-000000000099',
    'story_open',
    '00000000-0000-0000-0000-000000000101',
    NULL,
    NULL
  );
  IF v_result->>'outcome' <> 'limited' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: 31st non-duplicate event should be limited';
  END IF;

  v_result := public.aevora_ingest_reader_event(
    'reader-rpc-invalid-visitor-0001',
    '20000000-0000-0000-0000-000000000002',
    'chapter_start',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000111',
    NULL
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: mismatched chapter/series event was not rejected';
  END IF;

  v_accepted := 0;
  v_limited := 0;
  FOR i IN 1..31 LOOP
    v_result := public.aevora_ingest_reader_event(
      'reader-rpc-quota-boundary-0001',
      ('30000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'story_open',
      '00000000-0000-0000-0000-000000000101',
      NULL,
      NULL
    );
    IF v_result->>'outcome' = 'accepted' THEN v_accepted := v_accepted + 1; END IF;
    IF v_result->>'outcome' = 'limited' THEN v_limited := v_limited + 1; END IF;
  END LOOP;
  IF v_accepted <> 30 OR v_limited <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: per-minute quota boundary expected 30 accepted/1 limited, got %/%', v_accepted, v_limited;
  END IF;
END;
$rpc_behavior_assert$;
RESET ROLE;

-- Exercise the daily limit independently of the minute limit by clearing only
-- this fixture visitor's minute bucket between attempts on the disposable DB.
DO $daily_quota_assert$
DECLARE
  v_visitor text := 'reader-rpc-daily-boundary-0001';
  v_result jsonb;
  v_event_type text;
  i integer;
  v_accepted integer := 0;
  v_limited integer := 0;
BEGIN
  FOR i IN 1..1001 LOOP
    DELETE FROM aevora_private.reader_event_quota_buckets
    WHERE visitor_key_hash = md5(v_visitor)
      AND window_kind = 'minute';
    v_event_type := CASE (i - 1) % 4
      WHEN 0 THEN 'story_open'
      WHEN 1 THEN 'chapter_start'
      WHEN 2 THEN 'chapter_complete'
      ELSE 'follow'
    END;
    v_result := public.aevora_ingest_reader_event(
      v_visitor,
      NULL,
      v_event_type,
      '00000000-0000-0000-0000-000000000101',
      NULL,
      NULL
    );
    IF v_result->>'outcome' = 'accepted' THEN v_accepted := v_accepted + 1; END IF;
    IF v_result->>'outcome' = 'limited' THEN v_limited := v_limited + 1; END IF;
  END LOOP;
  IF v_accepted <> 1000 OR v_limited <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: global daily quota expected 1000 accepted/1 limited across four event classes, got %/%', v_accepted, v_limited;
  END IF;
END;
$daily_quota_assert$;

-- Verify an individual event class cannot exceed its own daily contribution cap
-- while the visitor remains well below the global daily quota.
DO $event_daily_quota_assert$
DECLARE
  v_visitor text := 'reader-rpc-event-daily-boundary-0001';
  v_result jsonb;
  i integer;
  v_accepted integer := 0;
  v_limited integer := 0;
BEGIN
  FOR i IN 1..251 LOOP
    DELETE FROM aevora_private.reader_event_quota_buckets
    WHERE visitor_key_hash = md5(v_visitor)
      AND window_kind = 'minute';
    v_result := public.aevora_ingest_reader_event(
      v_visitor,
      NULL,
      'story_open',
      '00000000-0000-0000-0000-000000000101',
      NULL,
      NULL
    );
    IF v_result->>'outcome' = 'accepted' THEN v_accepted := v_accepted + 1; END IF;
    IF v_result->>'outcome' = 'limited' THEN v_limited := v_limited + 1; END IF;
  END LOOP;
  IF v_accepted <> 250 OR v_limited <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: event-specific daily quota expected 250 accepted/1 limited, got %/%', v_accepted, v_limited;
  END IF;
END;
$event_daily_quota_assert$;


-- A rejected event-specific attempt must not consume the last global daily slot.
DO $rejected_event_does_not_consume_global_quota$
DECLARE
  v_visitor text := 'reader-rpc-no-budget-consumption-0001';
  v_hash text := md5(v_visitor);
  v_day timestamptz := date_trunc('day', statement_timestamp());
  v_minute timestamptz := date_trunc('minute', statement_timestamp());
  v_result jsonb;
  v_global_day_hits integer;
BEGIN
  INSERT INTO aevora_private.reader_event_quota_buckets(
    visitor_key_hash, quota_scope, window_kind, window_start, hit_count
  ) VALUES
    (v_hash, '*', 'day', v_day, 999),
    (v_hash, '*', 'minute', v_minute, 1),
    (v_hash, 'story_open', 'day', v_day, 250);

  v_result := public.aevora_ingest_reader_event(
    v_visitor, NULL, 'story_open',
    '00000000-0000-0000-0000-000000000101', NULL, NULL
  );
  IF v_result->>'outcome' <> 'limited' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: exhausted event-specific bucket was not limited';
  END IF;

  SELECT hit_count INTO v_global_day_hits
  FROM aevora_private.reader_event_quota_buckets
  WHERE visitor_key_hash = v_hash AND quota_scope = '*'
    AND window_kind = 'day' AND window_start = v_day;
  IF v_global_day_hits <> 999 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: rejected event consumed global daily quota; expected 999, got %', v_global_day_hits;
  END IF;

  v_result := public.aevora_ingest_reader_event(
    v_visitor, NULL, 'chapter_start',
    '00000000-0000-0000-0000-000000000101', NULL, NULL
  );
  IF v_result->>'outcome' <> 'accepted' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: different event class could not use remaining global quota slot';
  END IF;

  SELECT hit_count INTO v_global_day_hits
  FROM aevora_private.reader_event_quota_buckets
  WHERE visitor_key_hash = v_hash AND quota_scope = '*'
    AND window_kind = 'day' AND window_start = v_day;
  IF v_global_day_hits <> 1000 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: accepted event did not consume exactly one global daily slot';
  END IF;
END;
$rejected_event_does_not_consume_global_quota$;
