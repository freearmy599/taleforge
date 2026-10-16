-- Disposable PostgreSQL rehearsal for the Aevora atomic Gemini throttle RPC.
-- Run ONLY against a disposable database after applying the candidate migration.
-- This script intentionally wraps its fixture changes in a transaction and rolls back.
-- It is not a concurrency test; use separate concurrent sessions for that gate.

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
  IF to_regprocedure('public.aevora_record_gemini_throttle(text)') IS NULL THEN
    RAISE EXCEPTION 'atomic throttle RPC is missing; apply candidate migration to disposable DB first';
  END IF;

  DELETE FROM public.taleforge_ai_provider_state WHERE provider = 'gemini';

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('quota');
  IF NOT r.recorded OR r.consecutive_throttle_count <> 1 OR r.cooldown_hours <> 6 THEN
    RAISE EXCEPTION 'first quota observation incorrect: %', row_to_json(r);
  END IF;
  first_until := r.cooldown_until;

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('quota');
  IF r.consecutive_throttle_count <> 2 OR r.cooldown_hours <> 12 OR r.cooldown_until < first_until THEN
    RAISE EXCEPTION 'second quota observation incorrect: %', row_to_json(r);
  END IF;

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('quota');
  IF r.consecutive_throttle_count <> 3 OR r.cooldown_hours <> 24 THEN
    RAISE EXCEPTION 'third quota observation incorrect: %', row_to_json(r);
  END IF;

  UPDATE public.taleforge_ai_provider_state
  SET cooldown_until = future_until
  WHERE provider = 'gemini';

  SELECT * INTO STRICT r FROM public.aevora_record_gemini_throttle('overload');
  IF r.consecutive_throttle_count <> 4 OR r.cooldown_until < future_until THEN
    RAISE EXCEPTION 'cooldown was shortened or count not incremented: %', row_to_json(r);
  END IF;
  IF (SELECT last_error FROM public.taleforge_ai_provider_state WHERE provider = 'gemini')
      <> 'Gemini temporary overload response' THEN
    RAISE EXCEPTION 'diagnostic is not the fixed overload value';
  END IF;

  UPDATE public.taleforge_ai_provider_state
  SET consecutive_throttle_count = -1
  WHERE provider = 'gemini';

  BEGIN
    PERFORM * FROM public.aevora_record_gemini_throttle('quota');
  EXCEPTION WHEN SQLSTATE '22000' THEN
    caught := true;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'negative counter was not rejected';
  END IF;

  caught := false;
  BEGIN
    PERFORM * FROM public.aevora_record_gemini_throttle('raw provider message');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    caught := true;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'unsupported event class was not rejected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'aevora_record_gemini_throttle'
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'RPC must be SECURITY DEFINER';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.aevora_record_gemini_throttle(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'public.aevora_record_gemini_throttle(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE';
  END IF;
END;
$test$;

ROLLBACK;
