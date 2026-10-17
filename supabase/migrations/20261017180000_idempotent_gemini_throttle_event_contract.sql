-- Aevora Phase 1: align Gemini throttle RPC with deployed branch callers.
-- Branch-only candidate. Rehearse against disposable PostgreSQL and review
-- provenance/owner privileges before any production rollout.
--
-- The earlier one-argument RPC does not accept p_event_id, while callers pass
-- both p_event_id and p_event_class. This overload supplies the expected
-- two-argument contract and makes event retries idempotent.

CREATE TABLE IF NOT EXISTS public.aevora_gemini_throttle_events (
  event_id uuid PRIMARY KEY,
  event_class text NOT NULL CHECK (event_class IN ('quota', 'overload')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.aevora_gemini_throttle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aevora_gemini_throttle_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aevora_gemini_throttle_events FROM service_role;

CREATE OR REPLACE FUNCTION public.aevora_record_gemini_throttle(
  p_event_id uuid,
  p_event_class text
)
RETURNS TABLE (
  recorded boolean,
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
  v_inserted integer;
  v_existing_class text;
BEGIN
  IF p_event_id IS NULL OR p_event_class IS NULL
     OR p_event_class NOT IN ('quota', 'overload') THEN
    RAISE EXCEPTION 'invalid provider throttle event'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.aevora_gemini_throttle_events(event_id, event_class)
  VALUES (p_event_id, p_event_class)
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT e.event_class INTO v_existing_class
    FROM public.aevora_gemini_throttle_events AS e
    WHERE e.event_id = p_event_id;

    IF v_existing_class IS DISTINCT FROM p_event_class THEN
      RAISE EXCEPTION 'provider throttle event id reused with different class'
        USING ERRCODE = '22023';
    END IF;

    SELECT s.cooldown_until, s.consecutive_throttle_count
      INTO v_until, v_count
    FROM public.taleforge_ai_provider_state AS s
    WHERE s.provider = 'gemini';

    IF NOT FOUND OR v_count < 0 THEN
      RAISE EXCEPTION 'provider state is unavailable or malformed'
        USING ERRCODE = '22000';
    END IF;

    v_hours := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_until - v_now)) / 3600)::integer);
    RETURN QUERY SELECT true, v_until, v_count, v_hours;
    RETURN;
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
    RAISE EXCEPTION 'provider state counter is malformed'
      USING ERRCODE = '22000';
  END IF;

  v_hours := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_until - v_now)) / 3600)::integer);
  RETURN QUERY SELECT true, v_until, v_count, v_hours;
END;
$function$;

ALTER FUNCTION public.aevora_record_gemini_throttle(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) TO service_role;

COMMENT ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) IS
  'Atomically records idempotent allowlisted Gemini quota/overload events with fixed diagnostics and monotonic cooldown; service-role only.';
