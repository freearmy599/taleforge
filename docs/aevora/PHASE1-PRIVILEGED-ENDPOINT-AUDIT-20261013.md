# Aevora Phase 1 — privileged endpoint audit (2026-10-13)

## Finding

The live Supabase Edge Function inventory reports `verify_jwt=true` for the following functions, but source inspection found no explicit `isTrustedInternalApiKey` guard and no user-role authorization check in their handlers:

- `character-continuity` (v5)
- `world-continuity` (v9)
- `semantic-continuity-extraction` (v8)
- `blueprint-planner` (v13)
- `story-dna-planner` (v7)
- `arc-planner` (v11)

These handlers use the service-role key and perform privileged database work; several can also invoke Gemini. JWT verification alone does not establish that a caller is an authorized internal Aevora service. This is a **high-priority source-hardening candidate**, not a confirmed anonymous-access issue: the gateway still requires a valid JWT, and intended internal callers must be mapped before changing behavior.

## Safe remediation plan

1. Trace each caller and confirm whether it sends the configured server-side apikey.
2. Add the shared explicit internal-key guard before privileged database clients, Gemini requests, or writes.
3. Enforce POST for mutation/worker endpoints.
4. Add source-contract tests and Deno checks for all six functions.
5. Keep changes on `aevora/release-scheduler-hardening`; do not deploy or change schedules as part of this audit.

The live `aevora-control-plane-audit` function has `verify_jwt=false`, but its source does require the separately configured `AEVORA_AUDIT_TOKEN` Bearer token before any reads; the token value was not retrieved. This is a different authentication design and should not be mistaken for an unguarded endpoint.

No production configuration, function, data, or schedule was changed during this inspection.
