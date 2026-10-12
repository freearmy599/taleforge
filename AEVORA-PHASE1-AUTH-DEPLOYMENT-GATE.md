# Aevora Phase 1 — Release-handler authentication deployment gate

Status: **prepared only; production unchanged**  
Scope: `release-scheduler` and `release-publisher`  
Reason: the prepared handlers validate the `apikey` header explicitly and support named Supabase secret keys. The gateway's `verify_jwt` behavior must be evaluated from actual request evidence, not inferred from key format alone.

## Read-only production observations (2026-10-12)

- Production `release-scheduler` is ACTIVE v12 with `verify_jwt=true`.
- Production `release-publisher` is ACTIVE v21 with `verify_jwt=true`.
- The cron Vault credential metadata identifies a newer `sb_secret_...` key. Its value was not read, printed, or included in this document.
- The active `taleforge-release-tick` cron runs every five minutes and references the Vault credential. Its SQL was inspected only for metadata; no secret value or complete command was exposed.
- A read-only 24-hour log aggregation found **288 scheduler invocations, all HTTP 200**, with `apikey` and `Authorization` prefixes matching the same newer secret-key prefix. The logs also recorded `request.headers.sb_api_key_compatibility = minted` for all 288 requests.
- This observed `minted` compatibility mode reconciles the successful requests with the newer key format: the evidence does **not** establish a current gateway authentication outage. Do not disable `verify_jwt` solely because the key begins with `sb_secret_`. Confirm the platform's compatibility behavior and recheck logs before any auth configuration change.
- The prepared scheduler and publisher handlers validate `apikey` against the legacy service-role compatibility value or a named entry in server-side `SUPABASE_SECRET_KEYS`. New secret keys are rejected unless their exact JSON entry name is listed in `AEVORA_INTERNAL_API_KEY_NAMES` (comma-separated); an unset allowlist does not trust every configured secret.
- The prepared scheduler's internal publisher call currently uses the legacy `SUPABASE_SERVICE_ROLE_KEY` value for both headers. This preserves the existing legacy JWT path; do not switch it to a new secret key unless the Authorization and gateway behavior are handled intentionally.

## Required deployment plan — do not apply without explicit production authorization

1. Confirm the exact named secret-key entry used by the cron credential without reading or logging the key value. Confirm the runtime `SUPABASE_SECRET_KEYS` JSON entry names through a safe configuration surface; do not expose key values.
2. Preserve the current `verify_jwt=true` setting unless an authorized, controlled verification demonstrates it must change. The current 288/288 HTTP 200 result and `minted` compatibility-mode evidence are strong reasons not to treat this as a confirmed outage.
3. As a separately reviewed hardening change, prepare the cron request to send the newer secret key through `apikey` only, removing `Authorization: Bearer sb_secret_...` if confirmed compatible with the project's current gateway behavior. Keep the credential in Vault and retrieve it at call time; never hardcode it in cron SQL.
4. Confirm the runtime `SUPABASE_SECRET_KEYS` environment contains the expected named key, then configure `AEVORA_INTERNAL_API_KEY_NAMES` with only that exact JSON entry name (for example, `default` only if that is the confirmed real name). Keep values out of logs and source control.
5. Run the prepared handler auth regression tests and type checks, deploy only the reviewed scheduler/publisher pair after explicit authorization, then perform a controlled health verification that cannot publish chapters or mutate release schedules.
6. Verify rejection of missing, publishable, and ordinary user credentials and acceptance only for the intended internal key. Check logs without exposing credential values.

## Explicitly not done

- No production function deployment or `verify_jwt` configuration change.
- No Vault value read or rotation.
- No cron job or release-schedule mutation.
- No chapter generation or publication.
- No database migration or billable Supabase development branch.

## References

- Supabase API-key migration: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- Supabase Edge Function authentication: https://supabase.com/docs/guides/functions/auth
- Supabase authorization headers: https://supabase.com/docs/guides/functions/auth-headers
