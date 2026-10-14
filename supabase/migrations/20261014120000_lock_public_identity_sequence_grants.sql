-- Identity sequences are internal implementation details, not client APIs.
-- PostgreSQL identity-column inserts do not require callers to receive direct
-- sequence privileges. Preserve the trusted service_role grants and remove the
-- inherited/direct grants for ordinary client roles.
REVOKE ALL PRIVILEGES ON SEQUENCE public.aevora_engineering_events_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.reader_events_id_seq FROM PUBLIC, anon, authenticated;
