\set ON_ERROR_STOP on
DO $assert$
DECLARE
  v_count integer;
  v_until timestamptz;
  v_error text;
BEGIN
  SELECT consecutive_throttle_count, cooldown_until, last_error
    INTO v_count, v_until, v_error
  FROM public.taleforge_ai_provider_state
  WHERE provider = 'gemini';

  IF v_count <> 20 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: concurrent throttle events expected count 20, got %', v_count;
  END IF;
  IF v_until IS NULL OR v_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: cooldown was not persisted in the future';
  END IF;
  IF v_error <> 'Gemini quota or rate-limit response' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: quota diagnostic was not fixed and sanitized';
  END IF;
  IF has_function_privilege('anon', 'public.aevora_record_gemini_throttle(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: anon can execute throttle RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.aevora_record_gemini_throttle(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated can execute throttle RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.aevora_record_gemini_throttle(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role cannot execute throttle RPC';
  END IF;
END
$assert$;

-- An existing longer cooldown must survive a shorter overload event.
UPDATE public.taleforge_ai_provider_state
SET cooldown_until = clock_timestamp() + interval '48 hours'
WHERE provider = 'gemini';
SELECT * FROM public.aevora_record_gemini_throttle('overload');
DO $long_cooldown$
BEGIN
  IF (SELECT cooldown_until FROM public.taleforge_ai_provider_state WHERE provider = 'gemini')
      < clock_timestamp() + interval '47 hours' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: overload shortened an existing long cooldown';
  END IF;
END
$long_cooldown$;

-- Temporary overload with no active cooldown gets the fixed one-hour duration.
UPDATE public.taleforge_ai_provider_state
SET cooldown_until = NULL, consecutive_throttle_count = 0
WHERE provider = 'gemini';
SELECT * FROM public.aevora_record_gemini_throttle('overload');
DO $overload_duration$
DECLARE
  v_until timestamptz;
BEGIN
  SELECT cooldown_until INTO v_until FROM public.taleforge_ai_provider_state WHERE provider = 'gemini';
  IF v_until < clock_timestamp() + interval '55 minutes'
     OR v_until > clock_timestamp() + interval '65 minutes' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: overload cooldown was not approximately one hour';
  END IF;
  IF (SELECT last_error FROM public.taleforge_ai_provider_state WHERE provider = 'gemini')
      <> 'Gemini temporary overload response' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: overload diagnostic was not fixed and sanitized';
  END IF;
END
$overload_duration$;

-- Invalid persisted counters must fail without normalizing the row.
UPDATE public.taleforge_ai_provider_state
SET consecutive_throttle_count = -1
WHERE provider = 'gemini';
