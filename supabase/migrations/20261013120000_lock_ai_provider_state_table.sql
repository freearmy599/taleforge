-- Gemini provider state contains internal cooldown and diagnostic metadata.
-- Keep it server-side only; RLS alone does not block TRUNCATE or other table-level privileges.
ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated;
