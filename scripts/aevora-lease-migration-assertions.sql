\set ON_ERROR_STOP on
DO $lease_duration$
BEGIN
  BEGIN
    PERFORM public.aevora_claim_release_scheduler_lease(
      '00000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001', 29
    );
    RAISE EXCEPTION 'ASSERTION_FAILED: invalid lease duration did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'lease duration must be between 30 and 900 seconds' THEN RAISE; END IF;
  END;
  IF public.aevora_claim_release_scheduler_lease(NULL, '10000000-0000-0000-0000-000000000001', 300) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: null schedule claim succeeded';
  END IF;
END;
$lease_duration$;

DO $lease_behavior$
DECLARE
  s uuid := '00000000-0000-0000-0000-000000000011';
  token1 uuid := '10000000-0000-0000-0000-000000000001';
  token2 uuid := '10000000-0000-0000-0000-000000000002';
  series1 uuid := '00000000-0000-0000-0000-000000000001';
  series2 uuid := '00000000-0000-0000-0000-000000000002';
  next_at timestamptz := clock_timestamp() + interval '2 days';
  last_at timestamptz := clock_timestamp();
  original_next timestamptz;
BEGIN
  IF NOT public.aevora_claim_release_scheduler_lease(s, token1, 300) THEN RAISE EXCEPTION 'ASSERTION_FAILED: first lease claim failed'; END IF;
  IF public.aevora_claim_release_scheduler_lease(s, token2, 300) THEN RAISE EXCEPTION 'ASSERTION_FAILED: active lease was stolen'; END IF;
  IF public.aevora_renew_release_scheduler_lease(s, token2, 300) THEN RAISE EXCEPTION 'ASSERTION_FAILED: wrong token renewed lease'; END IF;
  IF NOT public.aevora_renew_release_scheduler_lease(s, token1, 300) THEN RAISE EXCEPTION 'ASSERTION_FAILED: owner could not renew lease'; END IF;
  IF public.aevora_release_scheduler_lease(s, token2) THEN RAISE EXCEPTION 'ASSERTION_FAILED: wrong token released lease'; END IF;
  IF NOT public.aevora_advance_release_schedule_if_lease_owned(s, token1, next_at, last_at) THEN RAISE EXCEPTION 'ASSERTION_FAILED: owner could not advance schedule'; END IF;
  SELECT next_release_at INTO original_next FROM public.release_schedules WHERE id=s;
  IF public.aevora_advance_release_schedule_if_lease_owned(s, token2, next_at + interval '1 day', next_at) THEN RAISE EXCEPTION 'ASSERTION_FAILED: wrong token advanced schedule'; END IF;
  IF (SELECT next_release_at FROM public.release_schedules WHERE id=s) IS DISTINCT FROM original_next THEN RAISE EXCEPTION 'ASSERTION_FAILED: schedule changed after wrong-token call'; END IF;
  IF public.aevora_advance_release_schedule_if_lease_owned(s, token1, last_at, last_at) THEN RAISE EXCEPTION 'ASSERTION_FAILED: non-forward schedule time accepted'; END IF;
  IF public.aevora_activate_story_lifecycle_if_lease_owned(s, token1, series2, clock_timestamp()) THEN RAISE EXCEPTION 'ASSERTION_FAILED: mismatched series activated'; END IF;
  IF NOT public.aevora_activate_story_lifecycle_if_lease_owned(s, token1, series1, clock_timestamp()) THEN RAISE EXCEPTION 'ASSERTION_FAILED: valid lifecycle activation failed'; END IF;
  IF (SELECT lifecycle_status FROM public.story_lifecycle WHERE series_id=series1) <> 'active' THEN RAISE EXCEPTION 'ASSERTION_FAILED: lifecycle status not active'; END IF;
  IF public.aevora_release_scheduler_lease(s, token2) THEN RAISE EXCEPTION 'ASSERTION_FAILED: wrong-token release succeeded'; END IF;
  IF NOT public.aevora_release_scheduler_lease(s, token1) THEN RAISE EXCEPTION 'ASSERTION_FAILED: owner release failed'; END IF;
  IF public.aevora_release_scheduler_lease(s, token1) THEN RAISE EXCEPTION 'ASSERTION_FAILED: second release reported success'; END IF;
  IF has_table_privilege('anon','public.aevora_release_scheduler_leases','select')
    OR has_table_privilege('authenticated','public.aevora_release_scheduler_leases','select')
    OR has_function_privilege('anon','public.aevora_claim_release_scheduler_lease(uuid,uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.aevora_claim_release_scheduler_lease(uuid,uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: client role retained lease table/RPC access';
  END IF;
  IF NOT has_function_privilege('service_role','public.aevora_claim_release_scheduler_lease(uuid,uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role cannot execute lease RPC';
  END IF;
END;
$lease_behavior$;
