-- Gemini provider state contains internal cooldown and diagnostic metadata.
-- Keep it server-side only; RLS alone does not block TRUNCATE or other table-level privileges.
ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY;

-- Older workers persisted raw Gemini error bodies for multiple HTTP statuses.
-- Redact every legacy diagnostic for this provider unless it is already one of
-- the small set of known-safe messages written by the hardened workers.
UPDATE public.taleforge_ai_provider_state
SET last_error = CASE
      WHEN last_error ILIKE '%Gemini HTTP 503%'
        OR last_error ILIKE '%temporarily unavailable%'
        OR last_error ILIKE '%overload%'
        THEN 'Gemini temporary overload response'
      WHEN last_error ILIKE '%Gemini HTTP 429%'
        OR last_error ILIKE '%RESOURCE_EXHAUSTED%'
        OR last_error ILIKE '%quota%'
        OR last_error ILIKE '%rate limit%'
        THEN 'Gemini quota or rate-limit response'
      ELSE 'Gemini provider diagnostic redacted'
    END,
    updated_at = now()
WHERE provider = 'gemini'
  AND last_error IS NOT NULL
  AND last_error NOT IN (
    'Gemini quota or rate-limit response',
    'Gemini temporary overload response',
    'Gemini quota, rate-limit, or temporary overload response',
    'Gemini HTTP 429 RESOURCE_EXHAUSTED',
    'Gemini provider diagnostic redacted'
  );

REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated;

-- Column-level grants are independent of relation-level grants.
DO $$
DECLARE
  column_list text;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
    INTO column_list
  FROM pg_attribute
  WHERE attrelid = 'public.taleforge_ai_provider_state'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;
END
$$;
