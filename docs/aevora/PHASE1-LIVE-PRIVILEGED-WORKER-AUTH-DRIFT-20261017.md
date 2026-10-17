# Phase 1 live privileged-worker authentication drift — 2026-10-17

## Scope and method

Read-only inspection of the currently deployed Supabase Edge Function inventory and retrieved function source for Aevora project `sxmbnlgufqhcwxcpcsvb`. This review compared live function source markers and caller-authentication patterns with the branch's shared `isTrustedInternalApiKey` guard and `scripts/aevora-internal-worker-auth-contract.test.mjs`.

This is a source/configuration drift finding, not proof that a particular request was exploited. The Edge gateway setting `verify_jwt=true` requires a valid JWT but does not, by itself, prove that the caller is an approved internal worker. Exact reachability and exploitability depend on gateway behavior, credentials available to callers, and application-level checks.

## Observed live inventory

The following deployed functions were retrieved. Each uses or references service-role credentials in its deployed source and did not contain the branch's `isTrustedInternalApiKey` guard in the inspected source. All were configured with `verify_jwt=true` at the time of inventory except where noted.

| Function | Live version | Live source marker / observation | Finding |
|---|---:|---|---|
| `release-scheduler` | 12 | `release-scheduler-v5-contiguous-approved-release` | No branch shared internal-key guard; creates service-role client |
| `release-publisher` | 21 | `release-publisher-v5-outbox` | No branch shared internal-key guard; creates service-role client |
| `generate-chapter` | 59 | `quality-v6` | No branch shared internal-key guard; creates service-role client |
| `revise-chapter` | 40 | `revision-v11-enforced-provider-cooldown` | No branch shared internal-key guard; creates service-role client |
| `generation-orchestrator` | 35 | `generation-orchestrator-v14-preserve-blueprints-on-governance-423` | No branch shared internal-key guard; creates service-role client |
| `review-orchestrator` | 11 | `review-orchestrator-v4-fail-closed-provider-state` | No branch shared internal-key guard; creates service-role client |
| `post-publication-canon-sync` | 6 | `post-publication-canon-sync-v3-intelligence-verified` | No branch shared internal-key guard; creates service-role client |
| `publication-sync-processor` | 4 | `publication-sync-processor-v1` | No branch shared internal-key guard; creates service-role client |
| `autonomous-series-creation-runner` | 6 | `aevora-autonomous-series-runner-v2-daily-chapters` | No branch shared internal-key guard; creates service-role client |

The separately inspected `aevora-control-plane-audit` function is configured with `verify_jwt=false`, but its source checks a dedicated `AEVORA_AUDIT_TOKEN` before any privileged REST reads, using a constant-time comparison helper. It is not classified as an ordinary internal worker by the branch's worker contract.

## Why this matters

- A valid JWT is not synonymous with a trusted internal-worker identity.
- The branch's source-contract suite explicitly requires the listed privileged workers to validate the shared internal API key before request-body parsing or privileged client creation.
- The deployed sources above do not match that branch-side contract, so passing branch CI does not establish live authentication parity.
- The scheduler/publisher remain especially urgent because the previously documented live versions also lack lease fencing and strict persisted-publication confirmation. The publisher's live marker is still the older outbox version, and the scheduler's live source accepts HTTP-success responses without enforcing the branch's full publication-confirmation contract.

## Required next actions

1. Keep automatic publication NO-GO.
2. Keep production unchanged until the owner explicitly authorizes a mitigation/deployment plan and rollback path.
3. Reconcile the exact deployed source and intended caller model for each function; do not blindly deploy the branch wholesale.
4. Verify scheduled invocations and server-to-server callers have the required allowlisted API key configuration before any rollout. Do not put a secret API key in browser code.
5. Prepare a narrow, staged rollout and rollback plan: first protect publication endpoints, then other privileged worker endpoints according to dependency/caller inventory; validate legitimate cron/worker invocations and reject public/client-role callers.
6. Re-run live read-only inventory after any separately authorized deployment and compare function versions/source markers with the branch.
7. Keep the dedicated audit endpoint's separate token model explicit; do not disable its token check or expose its token to browser code.

## Safety boundary

This review retrieved function metadata and source only. No database query that changes state, function deployment, environment-variable update, ACL/policy change, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. No live secret values were read or reproduced.


## Additional branch gateway-auth mismatch discovered and corrected — 2026-10-17

Supabase's current guidance states that new `sb_secret_...` keys are not JWTs. Edge Functions called with these keys should receive the key in `apikey`, disable the gateway's legacy JWT verification for that endpoint, and authenticate the key explicitly in handler code. References:
- [Supabase: Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase: Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)

The branch's previous `supabase/config.toml` explicitly disabled gateway JWT verification only for `reader-event-intake`, even though internal-worker handlers authenticate through the shared API-key guard and the live release cron credential was previously confirmed to be a newer non-JWT secret key. This was a branch deployment-readiness defect: legitimate calls could be rejected at the gateway before the handler-level guard runs.

Branch-only correction:
- [x] Explicitly set `verify_jwt = false` for the 18 functions in the internal-worker source-contract list, plus `aevora-control-plane-audit`, whose dedicated audit token is checked inside its handler.
- [x] Retain the explicit shared internal API-key check before privileged work; disabling gateway JWT verification is not authorization by itself.
- [x] Add a source-contract assertion that every listed internal worker, the dedicated-token audit endpoint, and the bounded public reader-event endpoint has an explicit `verify_jwt = false` config section.
- [ ] Wait for CI on the config/test commits to complete successfully before considering the branch candidate validated.

This is a branch-only configuration change. It does not alter deployed Edge Function settings. Before rollout, verify the named secret-key allowlist exists at runtime and matches the intended cron/worker key, ensure all privileged callers are covered by the handler guard, and test both legitimate internal calls and rejected publishable/user-key calls. Do not deploy without explicit owner authorization and rollback planning.
