# Aevora Phase 1 — Release-handler authentication deployment gate

Status: **prepared only; production unchanged**  
Scope: `release-scheduler` and `release-publisher`  
Reason: the prepared handlers validate the `apikey` header explicitly and support named Supabase secret keys. The gateway's `verify_jwt` behavior must be evaluated from actual request evidence, not inferred from key format alone.

## Read-only production observations (2026-10-12)

- Production `release-scheduler` is ACTIVE v12 with `verify_jwt=true`.
- Production `release-publisher` is ACTIVE v21 with `verify_jwt=true`.
- The cron Vault credential metadata identifies a newer `sb_secret_...` key. Its value was not read, printed, or included in this document.
- The active `taleforge-release-tick` cron runs every five minutes and references the Vault credential. A read-only `cron.job_run_details` aggregate for the latest 24 hours showed **288 succeeded, 0 non-succeeded** job runs. Its SQL was inspected only for metadata; no secret value or complete command was exposed.
- A read-only 24-hour log aggregation found **288 scheduler invocations, all HTTP 200**, with `apikey` and `Authorization` prefixes matching the same newer secret-key prefix. The logs also recorded `request.headers.sb_api_key_compatibility = minted` for all 288 requests. These counts and five-minute timestamps align with the 288 successful cron job runs.
- A fresh read-only log sample for **2026-10-12 12:00–13:15 UTC** found **15 scheduler function invocations, all HTTP 200**, and no release-publisher invocation in that function-edge window. This confirms recent scheduler availability, but does not prove the prepared branch has been deployed or validate publisher authentication.
- The successful function-edge invocations show that the **current observed request path is working**. The exact platform semantics of the `minted` marker have not been independently verified, so preserve this evidence and confirm the compatibility behavior before making auth changes. Do not disable `verify_jwt` solely because the key begins with `sb_secret_`.
- The prepared scheduler and publisher handlers validate `apikey` against the legacy service-role compatibility value or a named entry in server-side `SUPABASE_SECRET_KEYS`. New secret keys are rejected unless their exact JSON entry name is listed in `AEVORA_INTERNAL_API_KEY_NAMES` (comma-separated); an unset allowlist does not trust every configured secret.
- The prepared scheduler's internal publisher call currently uses the legacy `SUPABASE_SERVICE_ROLE_KEY` value for both headers. This preserves the existing legacy JWT path; do not switch it to a new secret key unless the Authorization and gateway behavior are handled intentionally.

## Required deployment plan — do not apply without explicit production authorization

1. Confirm the exact named secret-key entry used by the cron credential without reading or logging the key value. Confirm the runtime `SUPABASE_SECRET_KEYS` JSON entry names through a safe configuration surface; do not expose key values.
2. Preserve the current `verify_jwt=true` setting unless an authorized, controlled verification demonstrates it must change. The current 288/288 cron-run success and 288/288 scheduler HTTP 200 results, plus the `minted` compatibility-mode evidence, are strong reasons not to treat this as a confirmed outage.
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


## Phase 1 hardening gate update (read-only checks, 2026-10-17)

This section records newer branch/production findings. It does not authorize deployment.

- Branch `aevora/release-scheduler-hardening` at commit `9dc7999c905aa7a321f8dfc9ed927f6849583a05` passed the Aevora Edge source-validation workflow: [run 38994366065](https://github.com/freearmy599/taleforge/actions/runs/38994366065). This validates the prepared branch only; it is not evidence that production functions or migrations were updated.
- The prepared scheduler and publisher deliberately fail closed for real auto-publication while database commit-boundary publication authorization is unimplemented. Do not remove this stop as a deployment workaround. Before enabling automated publication, implement and test an authorization primitive that is enforced at the database write/commit boundary, then test duplicate races, existing-chapter paths, lease loss, partial failure, canon-sync failure, and schedule advancement.
- A read-only production migration-ledger check found the current hardening candidates unapplied. This includes scheduler lease foundation/fencing, internal RPC and table ACL locks, provider-state ACL lock, maintenance privilege revocations/default guards, the release readiness gate, and system-health read-surface lock. Production therefore must not be described as having these protections merely because branch CI is green.
- Default-privilege hardening has a known owner-context blocker: the current SQL execution role cannot administer `supabase_admin` defaults. The migration intentionally raises an exception rather than pretending a schema-scoped revoke can override global defaults or bypass ownership. Resolve this through an authorized owner-level procedure and rehearse it on a disposable database; do not weaken the guard or create a billable development branch.
- The release-readiness migration is operationally consequential: it can disable schedules that do not meet readiness criteria. Before any authorized application, record a schedule-by-schedule disposition and rollback/recovery plan. Do not run it as a routine schema migration.
- The latest read-only provider-state observation at **2026-10-17 02:25 UTC** showed the Gemini cooldown active, with nine consecutive throttle events and a recorded cooldown-until timestamp of **2026-10-17 10:00 UTC (3:30 PM India time)**. Re-read the state before resuming model-backed work; never infer the cooldown has ended from this document. Do not probe Gemini during the cooldown.
- No production migration, function deployment, ACL change, chapter generation/publication, or release-schedule mutation was performed during this check.

### Required order before release automation can be enabled

1. Finish branch-only regression tests for provider-state fail-closed behavior and publication authorization.
2. Complete disposable PostgreSQL rehearsals for every candidate migration, including trigger execution, role grants, RLS/policy behavior, sequence grants, default ACL owner handling, and service-role access.
3. Resolve the authorized `supabase_admin` default-privilege execution path without weakening migration assertions.
4. Prepare a reviewed migration order and schedule disposition/rollback plan; apply migrations only after explicit production authorization.
5. Deploy and verify the scheduler/publisher pair only after commit-boundary publication authorization exists. Keep automated publication blocked until every verification passes.
6. Re-check Gemini provider state and run a low-cost, bounded verification only after cooldown is inactive and the work is explicitly authorized.
