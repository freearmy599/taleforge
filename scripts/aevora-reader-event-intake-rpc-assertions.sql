\set ON_ERROR_STOP on

DO $rpc_acl_assert$
BEGIN
  IF has_function_privilege('anon', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aevora_ingest_reader_event(text,uuid,text,uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: reader-event RPC execution grants are not server-only';
  END IF;
  IF has_table_privilege('anon','aevora_private.reader_event_quota_buckets','SELECT')
     OR has_table_privilege('authenticated','aevora_private.reader_event_quota_buckets','SELECT')
     OR has_table_privilege('anon','aevora_private.reader_event_quota_buckets','INSERT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: public role can access private reader-event quota store';
  END IF;
END;
$rpc_acl_assert$;

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
