# Aevora Phase 1 — Release-handler authentication deployment gate

Status: **prepared only; production unchanged**  
Scope: `release-scheduler` and `release-publisher`  
Reason: Supabase's newer `sb_secret_...` keys are not JWTs. The Edge Functions Gateway's `verify_jwt` check validates legacy JWT-based keys, while the prepared handlers validate the `apikey` header explicitly.

## Read-only production observations (2026-10-12)

- Production `release-scheduler` is ACTIVE v12 with `verify_jwt=true`.
- Production `release-publisher` is ACTIVE v21 with `verify_jwt=true`.
- The cron Vault credential metadata identifies a newer `sb_secret_...` key. Its value was not read, printed, or included in this document.
- The prepared scheduler and publisher handlers validate `apikey` against server-side `SUPABASE_SECRET_KEYS` plus the legacy service-role compatibility value before constructing their privileged database clients.
- The prepared scheduler's internal publisher call currently uses the legacy `SUPABASE_SERVICE_ROLE_KEY` value for both headers. Do not switch that call to a new secret key unless its Authorization header is also corrected.

## Required deployment plan — do not apply without explicit production authorization

1. Confirm the exact named secret-key entry used by the cron credential. Keep key values out of logs, commits, and chat.
2. Configure both Edge Functions with `verify_jwt = false` (or the equivalent supported deployment setting), because the handler performs its own strict `apikey` validation. Do not disable verification on unrelated functions.
3. Update the prepared cron request so the newer secret key is sent in the `apikey` header only; remove `Authorization: Bearer sb_secret_...`. Store the key in Vault and retrieve it at call time. Never hardcode the key in cron SQL.
4. Confirm the runtime `SUPABASE_SECRET_KEYS` environment contains the expected named key and restrict handler acceptance to that key name if the cron is meant to use only one dedicated key. The current shared helper intentionally accepts any non-empty configured secret-key value; review this least-privilege point before production deployment.
5. Run the prepared handler auth regression tests and type checks, deploy only the reviewed scheduler/publisher pair, then make a controlled, explicitly authorized health verification that cannot publish chapters or mutate release schedules.
6. Verify 401 rejection for missing/publishable/user credentials and acceptance only for the intended internal key. Check logs without exposing credential values.

## Explicitly not done

- No production function deployment or `verify_jwt` configuration change.
- No Vault value read or rotation.
- No cron job or schedule mutation.
- No chapter generation or publication.
- No database migration or billable Supabase development branch.

## References

- Supabase API-key migration: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- Supabase Edge Function authentication: https://supabase.com/docs/guides/functions/auth
