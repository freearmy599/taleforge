# Aevora Bounded Engineering Worker Contract

## Status
Design-only contract. No worker is enabled by this document. The read-only audit workflow is separate from code-writing authority.

## Allowed autonomous operations
- Read project health, queue, logs, schema metadata, and repository files.
- Execute tasks explicitly classified as verification or maintenance with a zero-dollar budget ceiling.
- Make small reversible changes on a non-production branch after task allowlist checks.
- Run tests and produce a pull request with evidence.
- Record task outcomes, retries, heartbeats, and decision blockers.

## Prohibited without explicit owner approval
- Publishing or modifying reader-visible content.
- Deploying Edge Functions or production frontend code.
- Changing release schedules or turning on automatic publication.
- Bypassing Clara, RLS, authentication, or authorization.
- Deleting important data, changing secrets/privileges, or executing destructive migrations.
- Calling paid or quota-limited model APIs unless a budget and provider policy explicitly permit it.
- Merging or pushing worker-authored changes directly to the production branch.

## Task lifecycle
1. Select the highest-priority eligible task whose dependencies are completed.
2. Atomically claim it with a lease and idempotency key; increment attempts.
3. Write a start event and heartbeat.
4. Validate task type, allowed paths/actions, dependencies, budget ceiling, and required approvals.
5. Perform only the bounded task.
6. Run applicable tests; store exact command/result summaries and changed-file list.
7. Complete with evidence, or retry within max_attempts, or mark blocked with a reason.
8. Release the lease in all outcomes.
9. If a strategic choice is needed, create a decision record; continue unrelated eligible tasks.

## Safety invariants
- Default budget ceiling is USD 0.00. Never infer permission to spend from a task description.
- At most one worker lease per task; stale leases are recoverable only after checking the previous run.
- Every write must be idempotent or protected by a unique idempotency key.
- Secrets are never printed, committed, or placed in task evidence.
- The service-role key must not be exposed to client-side code. Prefer narrowly scoped credentials for GitHub and runtime.
- No automatic publication, merge, or production deployment.
- A scheduler's green status is not proof of task success; verify the durable result.
- A blocked task must not halt independent safe tasks.

## Required worker checks before activation
- Verify repository identity and default branch.
- Verify task-table RLS and service-role access.
- Add atomic claim/lease RPC with concurrency tests.
- Add allowlisted task executor; reject arbitrary SQL, shell, or arbitrary repository paths.
- Add hard execution timeout, maximum retries, per-run task cap, and zero-cost default.
- Add tests for duplicate delivery, stale lease, malformed task, missing credentials, quota errors, and decision-required tasks.
- Start in dry-run mode. Enable only read-only verification first.
- Require owner approval before enabling repository writes, production deploys, or any nonzero spending.

## Strategic decision required before code-writing autonomy
Choose the execution environment and credential model for a persistent coding worker. Recommended initial posture: GitHub Actions, least-privilege repository token, no model calls until budget/provider choice is explicit, PR-only changes, no auto-merge, no production deployment.
