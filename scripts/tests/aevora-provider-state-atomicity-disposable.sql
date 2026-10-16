-- Disposable PostgreSQL rehearsal for the idempotent Aevora Gemini throttle RPC.
-- Run ONLY against a disposable database after applying candidate migrations.
-- All fixture changes are rolled back. This is not a concurrency test.

BEGIN;

DO $test$
DECLARE
  r record;
  first_until timestamptz;
  future_until timestamptz := clock_timestamp() + interval '72 hours';
  caught boolean := false;
BEGIN
  IF to_regclass('public.taleforge_ai_provider_state') IS NULL THEN
    RAISE EXCEPTION 'provider-state table is missing';
  END IF;
  IF to_regprocedure('public.aevora_record_gemini_throttle(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'idempotent throttle RPC is missing; apply candidate migrations to disposable DB first';
  END IF;

  DELETE FROM public.taleforge_ai_provider_event_ledger;
  DELETE FROM public.taleforge_ai_provider_state WHERE provider = 'gemini';

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000001', 'quota');
  IF NOT r.recorded OR r.duplicate OR r.consecutive_throttle_count <> 1 OR r.cooldown_hours <> 6 THEN
    RAISE EXCEPTION 'first quota observation incorrect: %', row_to_json(r);
  END IF;
  first_until := r.cooldown_until;

  -- Replaying the same event must not increment quota escalation.
  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000001', 'quota');
  IF NOT r.recorded OR NOT r.duplicate OR r.consecutive_throttle_count <> 1 THEN
    RAISE EXCEPTION 'duplicate quota event was not idempotent: %', row_to_json(r);
  END IF;

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000002', 'quota');
  IF r.consecutive_throttle_count <> 2 OR r.cooldown_hours <> 12 OR r.cooldown_until < first_until THEN
    RAISE EXCEPTION 'second quota observation incorrect: %', row_to_json(r);
  END IF;

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000003', 'quota');
  IF r.consecutive_throttle_count <> 3 OR r.cooldown_hours <> 24 THEN
    RAISE EXCEPTION 'third quota observation incorrect: %', row_to_json(r);
  END IF;

  UPDATE public.taleforge_ai_provider_state
  SET cooldown_until = future_until
  WHERE provider = 'gemini';

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000004', 'overload');
  IF r.consecutive_throttle_count <> 3 OR r.cooldown_until < future_until THEN
    RAISE EXCEPTION 'overload changed quota counter or shortened cooldown: %', row_to_json(r);
  END IF;
  IF (SELECT last_error FROM public.taleforge_ai_provider_state WHERE provider = 'gemini')
      <> 'Gemini temporary overload response' THEN
    RAISE EXCEPTION 'diagnostic is not the fixed overload value';
  END IF;

  -- Reusing an event UUID for a different class must fail closed.
  caught := false;
  BEGIN
    PERFORM * FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000001', 'overload');
  EXCEPTION WHEN SQLSTATE '22000' THEN
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'event identity reuse with different class was not rejected'; END IF;

  UPDATE public.taleforge_ai_provider_state
  SET cooldown_until = NULL, consecutive_throttle_count = 0
  WHERE provider = 'gemini';
  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000005', 'overload');
  IF r.consecutive_throttle_count <> 0
     OR r.cooldown_until < clock_timestamp() + interval '55 minutes'
     OR r.cooldown_until > clock_timestamp() + interval '65 minutes' THEN
    RAISE EXCEPTION 'overload did not establish approximately one hour without changing counter: %', row_to_json(r);
  END IF;

  UPDATE public.taleforge_ai_provider_state SET consecutive_throttle_count = -1 WHERE provider = 'gemini';
  caught := false;
  BEGIN
    PERFORM * FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000006', 'quota');
  EXCEPTION WHEN SQLSTATE '22000' THEN caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'negative counter was not rejected'; END IF;

  caught := false;
  BEGIN
    PERFORM * FROM public.aevora_record_gemini_throttle('00000000-0000-0000-0000-000000000007', 'raw provider message');
  EXCEPTION WHEN SQLSTATE '22023' THEN caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'unsupported event class was not rejected'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'aevora_record_gemini_throttle'
      AND NOT p.prosecdef
  ) THEN RAISE EXCEPTION 'RPC must be SECURITY DEFINER'; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.aevora_record_gemini_throttle(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'public.aevora_record_gemini_throttle(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
     AND NOT has_function_privilege('service_role', 'public.aevora_record_gemini_throttle(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE';
  END IF;
END;
$test$;

ROLLBACK;
