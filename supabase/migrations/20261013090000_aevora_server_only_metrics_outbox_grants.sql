-- Keep internal telemetry and publication-sync queue tables server-side only.
-- Deliberately create no anon/authenticated policies: these tables are not client APIs.
DO $$
BEGIN
  IF to_regclass('public.publication_sync_outbox') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.publication_sync_outbox ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.publication_sync_outbox FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regclass('public.story_attachment_metrics') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.story_attachment_metrics ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.story_attachment_metrics FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;
