-- Gemini provider state contains internal cooldown and diagnostic metadata.
-- Keep it server-side only; RLS alone does not block TRUNCATE or other table-level privileges.
ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY;

-- Older workers persisted raw Gemini error bodies. Keep the cooldown signal but
-- replace matching provider payloads with a stable, non-sensitive diagnostic.
UPDATE public.taleforge_ai_provider_state
SET last_error = 'Gemini quota or rate-limit response',
    updated_at = now()
WHERE provider = 'gemini'
  AND last_error IS NOT NULL
  AND (
    last_error ILIKE '%Gemini HTTP 429%'
    OR last_error ILIKE '%RESOURCE_EXHAUSTED%'
    OR last_error ILIKE '%quota%'
    OR last_error ILIKE '%rate limit%'
  );

REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated;
