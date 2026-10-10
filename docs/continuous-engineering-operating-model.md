# Aevora Continuous Engineering Operating Model

## Purpose

Aevora should keep making safe, measurable engineering progress without requiring the owner to approve every routine step. Human attention is reserved for strategic decisions, meaningful risk, and irreversible actions.

## Operating rules

### Proceed autonomously with routine work
- Inspect current state before changing anything.
- Investigate errors and verify the underlying cause.
- Implement small, reversible fixes within the approved architecture.
- Run available checks and inspect the actual result.
- Continue to the next safe item in the active work queue rather than stopping after one fix.
- Keep a durable engineering ledger: task, reason, files/functions/tables changed, deployment/version, verification evidence, unresolved risks, and next task.
- Never report a task as complete based only on a successful deployment response; distinguish deployment verification from runtime verification.

### Pause for owner decisions
Pause the affected task and create a clear decision request before:
- Publishing or making reader-visible content live.
- Deleting important data or performing irreversible migrations.
- Weakening Clara, governance, authorization, or safety controls.
- Enabling autonomous production creation/publication or changing release schedules in a material way.
- Making a significant architectural commitment, introducing a new paid service, or exceeding the approved budget.
- Accessing new credentials, granting new privileges, or exposing private data.

A blocked task must not halt unrelated safe work.

## Required background architecture

1. **Durable task queue** — tasks with priority, status, dependencies, retry policy, lease/heartbeat, idempotency key, budget ceiling, and audit history.
2. **Bounded worker** — a server-side worker that claims one approved task at a time, performs a narrow operation, records evidence, and yields to the next task. Use leases so abandoned work can be recovered safely.
3. **Repository workflow** — changes should be made on a branch, checked by automated tests/lint/build where available, and delivered as a pull request for review. Production deployment remains gated until explicit policy permits it.
4. **Decision queue** — decisions include context, options, recommendation, consequences, expiry/urgency, and the task IDs blocked by the decision. Unrelated safe tasks continue.
5. **Observability** — real task outcomes, heartbeat age, retries, failures, quota/cost consumption, and alerts. A scheduler saying “succeeded” is not enough unless the intended operation's durable result is verified.
6. **Notifications** — send an actionable notification when a strategic decision or serious blocker appears. A scheduled ChatGPT reminder is only a periodic review; it is not a continuously running coding agent.
7. **Safety and budget** — least privilege, no secrets in logs, hard retry limits, provider cooldown enforcement, cost ceilings, no automatic publication, and no governance bypass.

## Current verified baseline (2026-10-10)

- Supabase has scheduled Aevora pipeline jobs running on 5-, 15-, 30-minute and hourly cadences; these are pipeline schedulers, not a general-purpose engineering agent.
- public.automation_config currently reports enabled=true and tick_minutes=15.
- The GitHub repository currently has a workflow for sitemap refresh; no general continuous engineering workflow was found in the repository's workflow directory.
- generate-chapter v54 includes a provider-cooldown guard; generation-orchestrator v31 includes retryable quota-failure recovery. Runtime behavior has not yet been proven by a new generation attempt because the Gemini cooldown is active.
- The Clockwork Sky release schedule is configured with auto_publish=false. Do not enable automatic publishing without owner approval.
- A ChatGPT scheduled-task creation attempt was rejected because the account is at its three-active-task limit. Do not remove an existing verification task merely to make room without checking whether its scheduled verification is still needed.

## Implementation sequence

1. Keep existing Aevora generation and publication safeguards intact; verify actual job outcomes and current health.
2. Add a durable engineering task/decision ledger and a read-only status summary, reusing existing structures where possible.
3. Define a narrow worker contract and task allowlist; start in dry-run/read-only mode.
4. Add branch-based repository changes and automated checks; do not auto-merge or auto-deploy initially.
5. Add bounded execution, retries, heartbeat recovery, cost limits, and auditable notifications.
6. Run controlled tests; only expand worker permissions after evidence supports doing so.
7. Keep publishing, destructive changes, governance changes, new spend, and major architecture decisions owner-gated.

## Definition of continuous progress

A task is complete only when the result is verified and recorded. The worker should then claim the next eligible task automatically. If one task requires an owner decision, it should wait only on that task and continue other safe, independent tasks. No system should claim to keep coding when no worker execution has actually occurred.


## Control-plane implementation update (2026-10-10)

- Added private-by-default Supabase ledgers: `aevora_engineering_tasks`, `aevora_engineering_decisions`, and `aevora_engineering_events`. RLS is enabled; `anon` and `authenticated` have no table privileges; `service_role` is the intended runtime role.
- Seeded four zero-budget tasks covering provider cooldown verification, scheduled-job outcome auditing, publication-safeguard verification, and worker-contract design.
- Added `scripts/aevora-control-plane-audit.mjs` and `.github/workflows/aevora-control-plane-audit.yml`. The workflow is scheduled every 15 minutes and can also be run manually. It is read-only against Supabase and reports findings in one GitHub issue.
- The audit requires the repository secret `SUPABASE_SERVICE_ROLE_KEY`. If it is not configured, the workflow reports the missing configuration in the same issue; do not paste the key into source code, issues, or chat.
- This is monitoring, not yet an autonomous code-writing worker. The worker remains disabled until its atomic task-claim path, narrow executor, tests, credential model, and owner-approved boundaries are in place.
- Deployment to GitHub is verified by commit SHA; successful scheduled runtime execution and alert delivery are not yet verified.


## Read-only audit monitor update (2026-10-10)

- Added and deployed Supabase Edge Function `aevora-control-plane-audit` version 1. It uses custom bearer-token authentication and returns a bounded operational snapshot; it performs only REST reads.
- GitHub Actions no longer receives the Supabase service-role key. It calls the audit endpoint using the separate `AEVORA_AUDIT_TOKEN` secret.
- Added a 15-minute scheduled workflow plus manual dispatch and push-based validation for changes to the audit files.
- Verified the workflow itself executes successfully and creates/updates GitHub issue #3 when its token is missing. Runtime data auditing is intentionally blocked until the same privately generated `AEVORA_AUDIT_TOKEN` is configured in Supabase Edge Function secrets and GitHub Actions repository secrets.
- GitHub issue: https://github.com/freearmy599/taleforge/issues/3
- Separately fixed the sitemap generator's mixed CommonJS/ESM syntax and replaced its missing CI secret dependency with the existing public Supabase publishable key. Verified run 38039166221 succeeded, generated 74 URLs (6 series and 62 published chapters), and committed the updated sitemap.


## Queue primitive implementation (2026-10-10)

- Added atomic, service-role-only claim/heartbeat/finish RPCs for the engineering queue.
- The claim RPC is deliberately limited to zero-budget verification and maintenance tasks with completed dependencies. It does not claim code-writing tasks.
- Verified table RLS and grants: anonymous/authenticated roles cannot select the task, decision, or event ledgers and cannot execute the queue RPCs; service_role can.
- These are queue primitives, not an active engineering worker. Runtime RPC tests and a worker executor remain pending.
