-- Aevora Phase 1: idempotent Gemini throttle event ledger.
-- BRANCH-ONLY CANDIDATE. Do not apply to production until provenance, ACL,
-- deployed-schema, disposable PostgreSQL, and Edge Runtime gates pass.
--
-- Each provider-call attempt gets one UUID event identity. Replays of the
-- same observation must reuse that UUID. Distinct provider calls need distinct
-- UUIDs. The generation orchestrator is an observer of child results and must
-- not record the same child failure a second time.

CREATE TABLE IF NOT EXISTS public.taleforge_ai_provider_event_ledger (
  event_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'gemini'),
  event_class text NOT NULL CHECK (event_class IN ('quota', 'overload')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.taleforge_ai_provider_event_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taleforge_ai_provider_event_ledger FROM PUBLIC;
REVOKE ALL ON TABLE public.taleforge_ai_provider_event_ledger FROM anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.aevora_record_gemini_throttle(text);

CREATE OR REPLACE FUNCTION public.aevora_record_gemini_throttle(
  p_event_id uuid,
  p_event_class text
)
RETURNS TABLE (
  recorded boolean,
  duplicate boolean,
  cooldown_until timestamptz,
  consecutive_throttle_count integer,
  cooldown_hours integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_until timestamptz;
  v_count integer;
  v_hours integer;
  v_last_error text;
  v_existing_class text;
  v_existing_provider text;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'provider event identity is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_class IS NULL OR p_event_class NOT IN ('quota', 'overload') THEN
    RAISE EXCEPTION 'unsupported provider event class'
      USING ERRCODE = '22023';
  END IF;

  v_last_error := CASE p_event_class
    WHEN 'quota' THEN 'Gemini quota or rate-limit response'
    WHEN 'overload' THEN 'Gemini temporary overload response'
  END;

  -- The ledger insert and provider-state mutation share this transaction.
  -- A duplicate event cannot increment state twice.
  INSERT INTO public.taleforge_ai_provider_event_ledger
    (event_id, provider, event_class, recorded_at)
  VALUES (p_event_id, 'gemini', p_event_class, v_now)
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT l.provider, l.event_class
      INTO v_existing_provider, v_existing_class
    FROM public.taleforge_ai_provider_event_ledger AS l
    WHERE l.event_id = p_event_id;

    IF v_existing_provider IS DISTINCT FROM 'gemini'
       OR v_existing_class IS DISTINCT FROM p_event_class THEN
      RAISE EXCEPTION 'provider event identity was reused with different attributes'
        USING ERRCODE = '22000';
    END IF;

    SELECT s.cooldown_until, s.consecutive_throttle_count
      INTO v_until, v_count
    FROM public.taleforge_ai_provider_state AS s
    WHERE s.provider = 'gemini';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider state missing for duplicate event'
        USING ERRCODE = '22000';
    END IF;
    IF v_count IS NULL OR v_count < 0 THEN
      RAISE EXCEPTION 'provider state counter is malformed'
        USING ERRCODE = '22000';
    END IF;

    v_hours := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_until - v_now)) / 3600)::integer);
    RETURN QUERY SELECT true, true, v_until, v_count, v_hours;
    RETURN;
  END IF;

  INSERT INTO public.taleforge_ai_provider_state AS current_state
    (provider, cooldown_until, consecutive_throttle_count,
     last_error, last_error_at, updated_at)
  VALUES (
    'gemini',
    v_now + make_interval(hours => CASE WHEN p_event_class = 'quota' THEN 6 ELSE 1 END),
    CASE WHEN p_event_class = 'quota' THEN 1 ELSE 0 END,
    v_last_error,
    v_now,
    v_now
  )
  ON CONFLICT (provider) DO UPDATE
  SET consecutive_throttle_count = CASE
        WHEN p_event_class = 'quota' THEN current_state.consecutive_throttle_count + 1
        ELSE current_state.consecutive_throttle_count
      END,
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
  WHERE current_state.consecutive_throttle_count IS NOT NULL
    AND current_state.consecutive_throttle_count >= 0
  RETURNING current_state.cooldown_until,
            current_state.consecutive_throttle_count
  INTO v_until, v_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider state counter is malformed or state update was rejected'
      USING ERRCODE = '22000';
  END IF;

  v_hours := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_until - v_now)) / 3600)::integer);
  RETURN QUERY SELECT true, false, v_until, v_count, v_hours;
END;
$function$;

ALTER FUNCTION public.aevora_record_gemini_throttle(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) TO service_role;

COMMENT ON TABLE public.taleforge_ai_provider_event_ledger IS
  'Idempotency ledger for sanitized provider throttle observations; no prompts, keys, or raw provider responses.';
COMMENT ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) IS
  'Atomically deduplicates a Gemini provider-call event and updates cooldown. Only quota events advance the quota counter; overload gets a minimum one-hour cooldown. Service-role only.';
