-- Add an optional client event idempotency key without rewriting historical rows.
-- This prevents the same logical event UUID from being counted more than once;
-- it does not authenticate visitor identity or stop spam using fresh UUIDs.
BEGIN;

ALTER TABLE public.reader_events
  ADD COLUMN IF NOT EXISTS event_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS reader_events_event_uuid_uidx
  ON public.reader_events (event_uuid)
  WHERE event_uuid IS NOT NULL;

COMMENT ON COLUMN public.reader_events.event_uuid IS
  'Optional client-generated idempotency key. Reused on retry; unique when present.';

COMMIT;
