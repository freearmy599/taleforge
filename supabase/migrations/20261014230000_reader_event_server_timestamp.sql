-- Prevent anonymous/authenticated clients from backdating or future-dating
-- engagement events while preserving trusted server-side event timestamps.
BEGIN;

CREATE OR REPLACE FUNCTION public.taleforge_force_reader_event_client_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.created_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.taleforge_force_reader_event_client_timestamp()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reader_event_server_timestamp ON public.reader_events;
CREATE TRIGGER trg_reader_event_server_timestamp
BEFORE INSERT ON public.reader_events
FOR EACH ROW
EXECUTE FUNCTION public.taleforge_force_reader_event_client_timestamp();

COMMENT ON FUNCTION public.taleforge_force_reader_event_client_timestamp() IS
  'Forces server statement time for anon/authenticated reader events; trusted service-role timestamps remain unchanged.';

COMMIT;
