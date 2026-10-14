# Aevora Phase 1 — Deployed Edge Function Drift Gate (2026-10-14)

## Scope

Read-only source comparison between deployed Supabase Edge Function source and `aevora/release-scheduler-hardening`. No function was deployed, no cron job was changed, and no database state was mutated.

## Confirmed deployment drift

| Function | Live version/source marker | Branch source marker / behavior | Status |
|---|---|---|---|
| `release-scheduler` | v12; no lease-claim or lease-renew RPC calls found in source | Branch source contains lease claim, renew, and release handling plus internal API-key validation | **Critical rollout gap:** concurrency protection exists in branch source but not deployed |
| `release-publisher` | v21; source marker `release-publisher-v5-outbox`; existing-chapter and duplicate-race paths can return success with `published: true` based on chapter existence, even if status is not actually `published` | Branch source includes internal API-key validation and additional status-safety logic | **Critical rollout gap:** live idempotency semantics remain weaker than branch source |
| `generate-chapter` | v59; `quality-v6` | Branch source `quality-v8-short-overload-cooldown`; stronger provider-state validation and quality-review eligibility checks | Branch is newer; not deployed |
| `generation-orchestrator` | v35 | Branch source contains `generation-orchestrator-v21-retryable-provider-overload` and internal API-key validation | Branch is newer; not deployed |
| `review-orchestrator` | v11; `review-orchestrator-v4-fail-closed-provider-state` | Branch retains fail-closed provider-state behavior and adds trusted internal API-key validation plus result sanitization | Branch is newer; not deployed |

Version numbers above are from the live function metadata; source markers are from the retrieved function source. A branch source file is not evidence that the live function runs that code.

## Important nuance

The live `generate-chapter` v59 source does contain provider cooldown checks, including a quality-review path. The current finding is therefore not “there is no live guard”; the difference is that branch source adds stricter handling for missing provider-state rows and quality-review eligibility, and remains unshipped.

The live `review-orchestrator` v11 source also fails closed when provider state cannot be read. The remaining branch/live gap includes trusted internal API-key enforcement and response sanitization; assess its call paths before rollout.

## Required rollout gates

1. Keep the scheduler lease migration and scheduler function deployment coordinated; deploying one without the other does not prove single-run execution.
2. Test publisher paths for: existing chapter with `draft`/non-published status, existing published chapter, duplicate insert race, output/blueprint synchronization failure, and truthful response flags.
3. Verify every internal caller sends the expected internal credential before requiring the new shared-key guard.
4. Run branch validation against the current commit after any code changes; verify TypeScript/Deno checks and focused contract tests.
5. Only after branch tests pass, review the diff and explicitly authorize a production rollout. No rollout is authorized by this audit.

## Verification

- Retrieved live source for `release-scheduler`, `release-publisher`, `generate-chapter`, `generation-orchestrator`, and `review-orchestrator`.
- Retrieved branch source for the same core functions.
- Confirmed the deployed scheduler source lacks lease-claim/renew calls while branch source includes them.
- Confirmed deployed publisher is v21 and branch publisher source is newer.
- No deployment, migration, publication, generation, or schedule mutation occurred.
- Phase 1 remains open.


## Additional scheduled-worker source drift (read-only, 2026-10-14)

A fresh live Edge Function inventory confirms that `autonomous-series-creation-runner` is ACTIVE at version 6, while the current hardening branch tree has no corresponding `supabase/functions/autonomous-series-creation-runner/index.ts`. Live cron job 13, `taleforge-autonomous-series-creation`, invokes this deployed function daily with `mode: scheduled`.

Read-only source inspection of deployed v6 shows it checks the bearer token against the service-role secret for scheduled mode, loads `taleforge_autonomous_creation_policy`, checks successful non-dry-run creations in the preceding seven days, then calls `taleforge_orchestrate_autonomous_series_creation`. If creation succeeds, it activates the series and initializes/updates `story_lifecycle` and a `release_schedules` row. This invocation was not run; no series, chapter, lifecycle, or schedule was changed.

**Gate:** treat this as production-only source drift. Before any release bundle or broad deployment is considered, recover/track the exact deployed source and verify its RPC/table dependencies and policy gates against the branch. Do not infer that a missing branch file means the live function is absent, and do not redeploy or invoke it as part of this audit.
