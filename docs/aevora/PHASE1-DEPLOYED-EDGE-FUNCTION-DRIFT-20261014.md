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


## Full live-versus-branch function inventory (read-only, 2026-10-14)

Comparing the live Supabase Edge Function inventory with the recursive tree for `aevora/release-scheduler-hardening` found these additional ACTIVE deployed functions without matching branch source paths:

- `chief-editor-monitor` (live v8)
- `autonomous-series-creation` (live v5)
- `aevora-operations-snapshot` (live v5)
- `autonomous-series-creation-runner` (live v6; also referenced by active cron job 13)
- `aevora-cover-worker` (live v4)
- `aevora-cover-request` (live v5)
- `aevora-cover-review` (live v4)

These may be intentionally omitted from the hardening branch, but that intent is not encoded in the current branch inventory. They must be treated as production-only components until their source, callers, database dependencies, auth behavior, and deployment ownership are reconciled. Do not deploy, disable, or invoke them as part of this audit. In particular, a broad deployment/release should not assume this branch is a complete mirror of all live Edge Functions.


## Production-only function dependency/auth follow-up (read-only, 2026-10-14)

Read-only retrieval of the remaining production-only function sources found the following relevant dependencies and auth patterns:

- `autonomous-series-creation` v5 directly reads `taleforge_story_opportunities` and `taleforge_story_concept_candidates` (both in the 41-table internal story-design set), plus its policy/run tables. It creates a service-role client only after validating a signed-in user's JWT and requiring `app_metadata.role` to be `admin` or `owner`. Its table access should continue to work after the candidate client-role revokes because those revokes do not target `service_role`.
- `autonomous-series-creation-runner` v6 uses the service-role key for scheduled work and invokes `taleforge_orchestrate_autonomous_series_creation`; the retrieved source checks that scheduled-mode bearer equals the service-role secret. This routine's internal dependencies must be included in the trusted-worker compatibility review.
- `chief-editor-monitor` v8 and `aevora-operations-snapshot` v5 validate a bearer JWT and require `admin`/ `owner` app metadata before returning operational data.
- `aevora-cover-request` v5 and `aevora-cover-review` v4 validate the user JWT and require `admin`/ `owner`; `aevora-cover-worker` v4 also checks that role before processing `aevora_cover_jobs`.

This source review did not invoke any endpoint, run the autonomous creation RPC, create/update cover jobs, or change production state. The findings are not a substitute for a full review of all deployed-only source, caller authentication, or runtime behavior.


## Production-only source fingerprints and execution-boundary clarification (read-only, 2026-10-14)

The deployed function source was retrieved again through the Supabase management interface. Record these exact version/hash pairs so later comparisons can detect silent source drift:

| Function | Live version | Retrieved source SHA-256 | Direct data/RPC scope observed |
|---|---:|---|---|
| `chief-editor-monitor` | 8 | `5cf478d5172a52a5778c88afa32ee0790dfe196daa241a7d7be46962713a4b0f` | Reads series/chapter/generation/lifecycle/schedule health and writes reports through `aevora_report_issue` |
| `autonomous-series-creation` | 5 | `cdce39df4064bcf817dcf497f90e410893718b266a1e8397fd758eb63baa395a` | Reads creation policy, orchestration runs, story opportunities and concept candidates; its retrieved v5 handler is **preflight-only** and rejects execute/dry-run-false requests |
| `aevora-operations-snapshot` | 5 | `3435a4ba075f7bbf1bebc3995ca2ef41e7a9eadb9a06f7c733e7d6d938afc693` | Admin/owner-gated operational snapshot across series, chapters, jobs, schedules, health/alerts and autonomous-creation status |
| `autonomous-series-creation-runner` | 6 | `d7aea3c7ee29c363ee828325a69e463a35d3b2f032b1b9ff8cb120b842260c4f` | Actual execution path: invokes `taleforge_orchestrate_autonomous_series_creation`, then may activate a series and initialize/update lifecycle and release schedule |
| `aevora-cover-worker` | 4 | `d1dfe5e65872a2f05e4746f0b6e2e9e01e3ade1aa06069be443281b07fde4374` | Admin/owner-gated queue readiness check only; explicitly reports generation disabled and does not claim jobs |
| `aevora-cover-request` | 5 | `1404678eda26cebfdd61e2bfaa0c2e848c508be164b15cf9244cf1ae4792e49b` | Admin/owner-gated request path reads series/genres and cover jobs; generation disabled in inspected response paths |
| `aevora-cover-review` | 4 | `68022a7c52446e72f37aadca93b85759bd333d3178de42247389449459a88c73` | Admin/owner-gated review path reads/updates cover jobs and series |

### Execution-boundary finding

Do not treat the function named `autonomous-series-creation` as the scheduled executor: the inspected v5 source is a preflight-only admin endpoint. The active daily cron calls the separate `autonomous-series-creation-runner` v6, which invokes the privileged creation RPC and then performs follow-up activation/lifecycle/schedule writes. Any Phase 1 access-control rollout must preserve the runner's service-role path while ensuring the RPC's execution ACL, validation, idempotency, and side effects are understood. A name-only inventory would miss this distinction.

All seven handlers validate a caller JWT and/or compare the scheduled runner's token to the service-role secret before privileged work in the reviewed code. This is source inspection only, not a runtime authorization test. Hashes are fingerprints of the retrieved source files, not cryptographic attestation of deployed execution after this timestamp.

No endpoint was invoked, no autonomous series was created, no cover job was processed, and no production state was changed during this follow-up.


## Autonomous creation RPC authorization and policy-gate review (read-only, 2026-10-14)

The production runner's privileged RPC chain was inspected through function catalog metadata and function definitions; no function was called.

- `public.taleforge_orchestrate_autonomous_series_creation(integer, boolean)` is owned by `postgres`, uses an empty configured search path, is `SECURITY DEFINER`, and is executable by `service_role` but not `anon` or `authenticated`. Its body also requires `auth.role() = 'service_role'`.
- It selects an eligible opportunity, reuses or designs a concept, calls `taleforge_autonomous_create_series`, and records an orchestrator decision snapshot. Its exception path records a failed run and re-raises.
- `public.taleforge_autonomous_create_series(uuid, jsonb, boolean)` has the same owner/security/search-path/effective-execute pattern and explicitly checks `auth.role() = 'service_role'`. A dry run returns before series creation. Non-dry-run execution requires a `strong_candidate` evaluation and a positive response from `taleforge_check_autonomous_creation_gate` before creating a **draft** series and its story architecture.
- `public.taleforge_check_autonomous_creation_gate(uuid, numeric)` is also service-role-only, `SECURITY DEFINER`, and uses an empty search path. Its source checks for a production policy row and enabled flag, opportunity and concept thresholds, total series cap, unpublished autonomous-series cap, and weekly autonomous-creation cap. The catalog/source review did not query the policy row's actual values or execute the gate.
- `taleforge_design_story_concept(uuid, jsonb)` is also service-role-only by effective EXECUTE checks and uses an empty search path. The runner then performs separate activation/lifecycle/schedule writes after a successful RPC result, so those follow-up writes must be tested together with the database gate rather than treating the RPC's draft-series creation as the end of the transaction.

### Compatibility implications

The proposed revokes on the 41 internal story-design relations target `PUBLIC`, `anon`, and `authenticated`, not `service_role`; the inspected RPC chain is therefore designed to retain its intended role path. That is necessary but not sufficient: a disposable-database test must verify function ownership, effective EXECUTE ACLs, the gate's disabled/missing/cap-reached cases, dry-run non-creation, successful draft creation, and runner follow-up behavior. The runner is not present in the hardening branch, so no broad Edge Function deployment can be considered complete until that production-only component is explicitly accounted for.

No policy row was read, no RPC/function was invoked, and no production state was changed during this review.


## Critical autonomous-runner activation ordering finding (read-only source review, 2026-10-14)

The complete deployed `autonomous-series-creation-runner` v6 source was re-read after the trigger audit. Its flow confirms a release-critical partial-bootstrap risk:

1. The runner calls the service-role orchestration RPC.
2. Once it receives `decision = 'created'`, it loads the new series.
3. It updates `series.status = 'ongoing'`.
4. Only afterward does it look up/write the `story_lifecycle` row.
5. Only afterward does it look up/write the `release_schedules` row with `enabled=true`, `auto_generate=true`, `auto_publish=true`, `interval_hours=24`, `timezone='Asia/Kolkata'`, and `next_release_at=now()`.
6. Finally it updates the run's pipeline snapshot.

The live `trg_enroll_series_in_production` trigger also fires on step 3 and itself enables automatic generation and publication when status becomes `ongoing`. Consequently, the later explicit schedule write is not the first point at which automation can become enabled. If a subsequent lifecycle/schedule/audit write fails, the endpoint returns `created_but_bootstrap_incomplete`, but the series and trigger side effects are already committed unless an external transaction boundary exists; the Edge Function's separate PostgREST requests do not form one transaction.

### Required repair design (not deployed)

- Make activation a final, explicit step only after the lifecycle and schedule bootstrap is ready; however, because the trigger enables auto-publish during activation, that alone does not solve failure between activation and final audit bookkeeping.
- Prefer a database-side atomic bootstrap/activation routine that creates the draft, lifecycle, and **disabled** schedule together, validates all prerequisites, and only then performs a guarded activation/schedule enablement in one transaction.
- Alternatively, maintain schedules disabled until all bootstrap and audit invariants are verified, then perform one controlled enablement transition; make the trigger respect an explicit activation gate rather than unconditionally turning on `auto_publish` for every transition to `ongoing`.
- Ensure retries are idempotent and reconcile an existing partially bootstrapped series without accidentally enabling publishing. A response reporting bootstrap failure must not leave a series eligible for a release tick.
- Test concurrent scheduler ticks during activation, transaction rollback, missing lifecycle/schedule, failed audit snapshot write, retry after timeout, and all series-status transitions in a disposable database.

### Disposition

**Release blocker:** production autonomous creation currently spans multiple network/database requests and uses a status trigger that turns on auto-publication before bootstrap completion. Do not enable or deploy the runner as a verified safe pipeline until the activation boundary is made atomic or equivalent disabled-until-ready gating is proven. This source review did not invoke the runner, alter a series, change a schedule, or publish/generate content.


### Follow-up confirmation: trigger-created schedule is immediately due (read-only catalog/source review)

The live `release_schedules` column defaults show `next_release_at` is nullable with no default. The series-status trigger inserts a schedule for an ongoing series with `enabled=true`, `auto_generate=true`, and `auto_publish=true`, but does not set `next_release_at`. The hardening-branch scheduler's due query explicitly accepts `next_release_at IS NULL` and, for an unscoped live run, selects enabled `auto_publish=true` schedules.

That combination makes the trigger-created schedule eligible for the release scheduler immediately, before the autonomous runner finishes its subsequent lifecycle/schedule/audit requests. This is not just a theoretical partial-bootstrap concern: a concurrent release tick can observe the trigger-created row in that intermediate state. A later runner update may set the 24-hour cadence, but it cannot retroactively prevent a scheduler that already selected and claimed the row.

**Required invariant:** newly created series must not become visible as enabled/auto-publishable to the release scheduler until lifecycle and schedule bootstrap has completed and an explicit readiness gate is true. The readiness check should be enforced server-side/database-side and in the scheduler query; relying on request ordering in the runner is insufficient. Verify this with a deterministic concurrency test before any production rollout.


## Completed-series publication semantics require an explicit policy decision (read-only source review, 2026-10-14)

The hardening-branch scheduler's initial series-status guard skips `draft`, `cancelled`, and `hiatus`, but does not skip `completed`. The branch publisher's series-status guard likewise rejects `draft`, `cancelled`, and `hiatus`, but does not explicitly reject `completed`. The live series-status trigger disables automation when a series transitions to `completed`, but that is a schedule mutation convention rather than an independent publication invariant.

This is not classified as a confirmed defect until the product meaning of `completed` is confirmed: a series might be marked completed only after its last chapter is published, in which case further publication should be blocked; alternatively, an intentional editorial workflow might mark a series completed before a final scheduled chapter is released. The code currently leaves that semantic choice implicit.

**Required release gate:** document the lifecycle contract and test it at both scheduler and publisher boundaries. If `completed` means no additional chapters may publish, reject it in both components and test direct publisher invocation with otherwise-valid review gates, stale enabled schedules, and retry paths. If a final chapter is allowed after completion, represent that as a distinct explicit exception (for example, a terminal-release authorization) rather than allowing every completed series through the general path.

No status was changed and no publication was attempted during this review.
