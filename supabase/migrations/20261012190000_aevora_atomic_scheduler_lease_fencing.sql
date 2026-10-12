-- Atomic lease-fenced writes used by the prepared Aevora release scheduler.
-- Source-only migration preparation: do not apply until explicitly authorized.
-- These functions close the race between lease renewal and a separate PostgREST update.

CREATE OR REPLACE FUNCTION public.aevora_advance_release_schedule_if_lease_owned(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_next_release_at timestamptz,
  p_last_release_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
  v_affected integer;
BEGIN
  IF p_schedule_id IS NULL OR p_lease_token IS NULL
     OR p_next_release_at IS NULL OR p_last_release_at IS NULL
     OR p_next_release_at <= p_last_release_at THEN
    RETURN false;
  END IF;

  SELECT lease_token, lease_expires_at
    INTO v_lease_token, v_lease_expires_at
    FROM public.aevora_release_scheduler_leases
    WHERE schedule_id = p_schedule_id
    FOR UPDATE;

  IF NOT FOUND
     OR v_lease_token <> p_lease_token
     OR v_lease_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  UPDATE public.release_schedules
    SET next_release_at = p_next_release_at,
        last_release_at = p_last_release_at,
        updated_at = clock_timestamp()
    WHERE id = p_schedule_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aevora_activate_story_lifecycle_if_lease_owned(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_series_id uuid,
  p_reviewed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
  v_affected integer;
BEGIN
  IF p_schedule_id IS NULL OR p_lease_token IS NULL
     OR p_series_id IS NULL OR p_reviewed_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT lease_token, lease_expires_at
    INTO v_lease_token, v_lease_expires_at
    FROM public.aevora_release_scheduler_leases
    WHERE schedule_id = p_schedule_id
    FOR UPDATE;

  IF NOT FOUND
     OR v_lease_token <> p_lease_token
     OR v_lease_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;

  PERFORM 1
    FROM public.release_schedules
    WHERE id = p_schedule_id AND series_id = p_series_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.story_lifecycle
    SET lifecycle_status = 'active',
        last_lifecycle_review_at = p_reviewed_at,
        updated_at = clock_timestamp()
    WHERE series_id = p_series_id
      AND lifecycle_status = 'preparing';

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.aevora_advance_release_schedule_if_lease_owned(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aevora_activate_story_lifecycle_if_lease_owned(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_advance_release_schedule_if_lease_owned(uuid, uuid, timestamptz, timestamptz) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.aevora_activate_story_lifecycle_if_lease_owned(uuid, uuid, uuid, timestamptz) TO postgres, service_role;
