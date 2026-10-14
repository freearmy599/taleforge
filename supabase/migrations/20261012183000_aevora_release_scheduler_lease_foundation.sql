-- Aevora release-scheduler lease foundation.
-- Reconstructed from read-only inspection of the existing live table and RPC
-- definitions so fresh environments can reproduce the scheduler prerequisite.
-- This source migration is prepared for review; do not apply without separate authorization.

CREATE TABLE IF NOT EXISTS public.aevora_release_scheduler_leases (
  schedule_id uuid PRIMARY KEY,
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.aevora_release_scheduler_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aevora_release_scheduler_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.aevora_release_scheduler_leases TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.aevora_claim_release_scheduler_lease(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  affected integer;
BEGIN
  IF p_schedule_id IS NULL OR p_lease_token IS NULL THEN
    RETURN false;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'lease duration must be between 30 and 900 seconds';
  END IF;

  INSERT INTO public.aevora_release_scheduler_leases
    (schedule_id, lease_token, lease_expires_at, created_at, updated_at)
  VALUES
    (p_schedule_id, p_lease_token, clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds), clock_timestamp(), clock_timestamp())
  ON CONFLICT (schedule_id) DO UPDATE
    SET lease_token = EXCLUDED.lease_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = clock_timestamp()
    WHERE public.aevora_release_scheduler_leases.lease_expires_at <= clock_timestamp();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aevora_renew_release_scheduler_lease(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  affected integer;
BEGIN
  IF p_schedule_id IS NULL OR p_lease_token IS NULL THEN
    RETURN false;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'lease duration must be between 30 and 900 seconds';
  END IF;

  UPDATE public.aevora_release_scheduler_leases
  SET lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE schedule_id = p_schedule_id
    AND lease_token = p_lease_token
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aevora_release_scheduler_lease(
  p_schedule_id uuid,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.aevora_release_scheduler_leases
  WHERE schedule_id = p_schedule_id AND lease_token = p_lease_token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.aevora_claim_release_scheduler_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aevora_renew_release_scheduler_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aevora_release_scheduler_lease(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_claim_release_scheduler_lease(uuid, uuid, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.aevora_renew_release_scheduler_lease(uuid, uuid, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.aevora_release_scheduler_lease(uuid, uuid) TO postgres, service_role;
