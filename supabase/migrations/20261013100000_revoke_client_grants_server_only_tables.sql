-- Defense in depth for server-only tables.
-- Keep RLS enabled and intentionally do not create client-facing policies.
-- Service-role Edge Functions retain their existing privileges.
REVOKE ALL PRIVILEGES ON TABLE
  public.publication_sync_outbox,
  public.story_attachment_metrics
FROM anon, authenticated;
