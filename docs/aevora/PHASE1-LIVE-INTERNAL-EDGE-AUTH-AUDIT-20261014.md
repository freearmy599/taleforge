# Aevora Phase 1 — Live Internal Edge Function Authorization Audit
Date: 2026-10-14
Status: read-only finding; branch repair prepared; no production requests or deployments.

## Finding

The deployed project has 18 internal workers with `verify_jwt=true` but without a handler-level trusted-caller check in the inspected live source. Each creates a service-role client, calls Gemini, or performs privileged orchestration. Platform JWT verification alone is not authorization: a legacy project anon key is itself a signed JWT, so callers must not be trusted merely because the gateway accepted the bearer token. The Supabase Edge Functions documentation describes JWT verification and function authorization separately.

No endpoint was invoked to test this finding. A live probe could trigger generation, review, publication, schedule advancement, or provider spend.

## Deployed workers requiring the branch guard

| Function | Deployed version |
|---|---:|
| `release-scheduler` | 12 |
| `release-publisher` | 21 |
| `generation-orchestrator` | 35 |
| `review-orchestrator` | 11 |
| `generate-chapter` | 59 |
| `revise-chapter` | 40 |
| `continuity-review` | 10 |
| `originality-review` | 9 |
| `safety-review` | 9 |
| `publication-review` | 8 |
| `blueprint-planner` | 13 |
| `story-dna-planner` | 7 |
| `arc-planner` | 11 |
| `character-continuity` | 5 |
| `world-continuity` | 9 |
| `post-publication-canon-sync` | 6 |
| `publication-sync-processor` | 4 |
| `semantic-continuity-extraction` | 8 |

All 18 are configured with `verify_jwt=true`; the inspected deployed handlers do not validate a trusted internal API key or require an admin/owner role before privileged work. Business checks later in a handler are not a substitute for authenticating the caller at entry.

## Branch repair and validation

The branch adds a shared fail-closed guard in `supabase/functions/_shared/internal-api-key.ts` and wires it into the 18 workers. The guard accepts the configured server-side Supabase key or an explicitly configured internal key through the `apikey` header; it rejects missing, malformed, or untrusted credentials before business work. The branch contract test enumerates all 18 functions. Internal Edge Function calls and cron dispatch must continue to send the trusted key in `apikey`; do not move service-role credentials into browser code.

## Safe rollout requirements

1. Review the shared helper and every call site as one change set.
2. Confirm the deployed cron commands and server-side callers send the trusted key in `apikey`; browser callers must not.
3. Deploy only after the dependent scheduler lease/atomic-transition migrations are approved and applied in the correct order.
4. After explicit rollout authorization, use a safe pre-work authorization check to confirm an anon credential is rejected and a trusted server caller succeeds. Do not use generation/publication endpoints for unauthenticated probes.
5. Keep the branch authorization contract test in CI and compare deployed function versions against repository source after rollout.

## Guarded functions outside this list

The read-only inventory found separate handler-level authorization in the deployed admin/owner tools (`chief-editor-monitor`, `autonomous-series-creation`, `aevora-operations-snapshot`, and the three cover functions), plus an internal scheduler-credential/admin mode in `autonomous-series-creation-runner` and a dedicated verification token in `aevora-control-plane-audit`. These functions are not included in the 18-worker list above. Several of them are absent from this repository branch, which is recorded in the source-of-truth inventory.

## Safety boundary

No production Edge Function was called, deployed, or modified. No secrets were read or printed. The production authorization gap remains open until the branch guard is deployed through an approved release.
