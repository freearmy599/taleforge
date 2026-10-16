-- Aevora Phase 1: atomic Gemini provider cooldown recording.
-- BRANCH-ONLY CANDIDATE. Do not apply to production until the provenance,
-- caller, privilege, and disposable-PostgreSQL gates are reviewed.
--
-- Each qualifying observation increments the counter exactly once per RPC call.
-- There is no event-id parameter, so this is not idempotent across duplicate calls.
-- Raw provider error text is never accepted or stored.

CREATE OR REPLACE FUNCTION public.aevora_record_gemini_throttle(p_event_class text)
RETURNS TABLE (
  recorded boolean,
  cooldown_until timestamptz,
  consecutive_throttle_count integer,
  cooldown_hours integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_until timestamptz;
  v_count integer;
  v_hours integer;
  v_last_error text;
BEGIN
  IF p_event_class IS NULL OR p_event_class NOT IN ('quota', 'overload') THEN
    RAISE EXCEPTION 'unsupported provider event class'
      USING ERRCODE = '22023';
  END IF;

  v_last_error := CASE p_event_class
    WHEN 'quota' THEN 'Gemini quota or rate-limit response'
    WHEN 'overload' THEN 'Gemini temporary overload response'
  END;

  INSERT INTO public.taleforge_ai_provider_state AS current_state
    (provider, cooldown_until, consecutive_throttle_count,
     last_error, last_error_at, updated_at)
  VALUES (
    'gemini',
    v_now + make_interval(hours =>
      CASE WHEN p_event_class = 'overload' THEN 1 ELSE 6 END),
    1,
    v_last_error,
    v_now,
    v_now
  )
  ON CONFLICT (provider) DO UPDATE
  SET consecutive_throttle_count = current_state.consecutive_throttle_count + 1,
      cooldown_until = GREATEST(
        COALESCE(current_state.cooldown_until, '-infinity'::timestamptz),
        v_now + make_interval(hours =>
          CASE
            WHEN p_event_class = 'overload' THEN 1
            ELSE LEAST(24, 6 * power(2, LEAST(current_state.consecutive_throttle_count, 2))::integer)
          END)
      ),
      last_error = EXCLUDED.last_error,
      last_error_at = v_now,
      updated_at = v_now
  WHERE current_state.consecutive_throttle_count >= 0
  RETURNING current_state.cooldown_until,
            current_state.consecutive_throttle_count
  INTO v_until, v_count;

  IF NOT FOUND THEN
    -- Existing negative counters are treated as corrupt state, never reset.
    RAISE EXCEPTION 'provider state counter is malformed'
      USING ERRCODE = '22000';
  END IF;

  v_hours := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_until - v_now)) / 3600)::integer);
  RETURN QUERY SELECT true, v_until, v_count, v_hours;
END;
$function$;

REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_record_gemini_throttle(text) TO service_role;

COMMENT ON FUNCTION public.aevora_record_gemini_throttle(text) IS
  'Atomically records one allowlisted Gemini quota/overload observation with fixed diagnostics and monotonic cooldown. Service-role only; not idempotent across duplicate calls.';
