# Aevora cron dispatch — new secret API-key header drift (2026-10-17)

## Read-only inventory result

A metadata-only query inspected active `cron.job` records whose command contains `net.http_post`. It returned only job IDs/names, parsed target function slugs, booleans for header-name references, the referenced Vault secret name, and credential shape metadata. It did not return raw SQL, header values, request bodies, response bodies, or the secret itself.

All seven jobs below reference Vault secret `taleforge_service_role_key`, whose metadata is 41 characters, `sb_secret_...` format, and not JWT-shaped.

| Cron job | Target function | Has `apikey` header reference | Has `Authorization` header reference |
|---|---|---:|---:|
| `taleforge-generation-tick` (job 3) | `generation-orchestrator` | Yes | Yes |
| `taleforge-release-tick` (job 4) | `release-scheduler` | Yes | Yes |
| `taleforge-blueprint-tick` (job 5) | `blueprint-planner` | Yes | Yes |
| `taleforge-dna-tick` (job 6) | `story-dna-planner` | Yes | Yes |
| `taleforge-arc-tick` (job 7) | `arc-planner` | Yes | Yes |
| `taleforge-publication-sync` (job 9) | `publication-sync-processor` | Yes | Yes |
| `taleforge-semantic-continuity-tick` (job 10) | `semantic-continuity-extraction` | Yes | Yes |
| `taleforge-autonomous-series-creation` (job 13) | `autonomous-series-creation-runner` | **No** | Yes |

The inspected live Edge Function configuration reports `verify_jwt=true` for these targets. Their retrieved deployed source versions do not contain the branch's shared internal-key guard.

## Interpretation

Supabase's current [API-key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) states that new secret keys are not JWTs, should be sent in `apikey`, and should not be sent as `Authorization: Bearer ...` because the gateway attempts JWT parsing. The [Edge Function auth guide](https://supabase.com/docs/guides/functions/auth) recommends disabling gateway JWT verification for service-to-service secret-key calls and performing explicit handler-level authentication.

Therefore:
- Jobs 3, 4, 5, 6, 7, 9, and 10 have a header shape incompatible with the new key model while their targets retain `verify_jwt=true`; gateway rejection is a high-confidence risk. Their actual recent HTTP outcomes were not queried in this audit, so this report does not claim to have observed a particular error response.
- Job 13 has the same non-JWT secret in `Authorization` but lacks `apikey`; its current handler additionally compares the bearer token to the legacy service-role JWT, a confirmed credential-format mismatch.
- Simply setting `verify_jwt=false` in production before deploying guarded handlers would be unsafe: the inspected live handler sources lack the branch's explicit internal-key guard. Configuration and handler code must be deployed as one reviewed unit.

## Branch-side preparation

- [x] Branch `supabase/config.toml` now explicitly sets `verify_jwt=false` for the 18 shared-guard workers, the mixed-mode autonomous runner, the dedicated-token audit endpoint, and the existing bounded public reader-event endpoint.
- [x] Shared-guard handlers must validate the incoming `apikey` against the legacy-key fallback or an explicitly allowlisted named secret in `SUPABASE_SECRET_KEYS` before creating privileged clients.
- [x] The autonomous runner branch candidate validates scheduled mode using `apikey`, and retains separate Supabase-user/admin-role validation for interactive admin mode.
- [x] Branch handler/config/source-contract validation and disposable PostgreSQL rehearsal passed on commit [`3984f6c`](https://github.com/freearmy599/taleforge/commit/3984f6c0e603029a636eadf13b1faf1e7280f70d): [run 39010227908](https://github.com/freearmy599/taleforge/actions/runs/39010227908). The auth contract verifies fail-closed behavior and the runner's scheduled-key guard assignment pattern. This is branch-only evidence; it does not verify the live deployed versions or authorize a rollout.
- [ ] Reconcile every production cron command so the new secret is sent in `apikey` only, removing the new secret from `Authorization`. Keep job cadence, body, and semantics unchanged.
- [ ] Verify the handler-level guard and named-key allowlist on each endpoint before changing any live gateway configuration or caller command.

## Rollout safety

This is a read-only audit and branch-only preparation. No cron command, Edge Function configuration, function deployment, secret, schedule, series, chapter, or production database state was changed. Do not use actual generation or publication as a smoke test. Obtain explicit owner authorization, capture a protected exact pre-change command baseline, and prepare rollback before any live cron/header/configuration change. Automated generation/publication remains NO-GO until the authentication and publication-safety gates are independently verified.
