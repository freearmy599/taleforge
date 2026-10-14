# Aevora Phase 1 — Production rollout sequencing review (plan only)

Date: 2026-10-14  
Branch: \`aevora/release-scheduler-hardening\`  
Status: proposed sequence for review; **not deployment authorization**.

## Why an explicit sequence is required

The read-only deployed-source inventory recorded in \`PHASE1-SUPABASE-COMPATIBILITY-ROLLBACK-GATE-20261014.md\` confirms material drift: production scheduler v12 and publisher v21 do not contain the candidate readiness controls; deployed generator/revision/review orchestrators also differ from this branch. A successful branch CI run therefore does not establish production safety.

A database migration and several Edge Function deployments cannot be treated as one atomic operation. The rollout must avoid a window where an old worker can call an unguarded publisher/generator or an old scheduler can act on schedules that have not been approved.

## Hard preconditions — rollout remains blocked until each is evidenced

1. **Invocation inventory:** identify every cron, database trigger, dashboard action, external HTTP caller, and orchestrator that can invoke the scheduler, generation/revision workers, review workers, publisher, or autonomous-series runner. Record how each is paused and resumed.
2. **Pre-change baseline:** capture the exact production definitions and metadata for touched functions/triggers, table/column grants, RLS/policies, schema objects, function ownership/security/search paths/EXECUTE grants, and all release-schedule flags/timestamps. The disposable fixture baseline is not a production baseline.
3. **Gate A evidence:** resolve the read-only Supabase catalog evidence gap. A failed or blocked catalog query is not a pass.
4. **Rollback proof:** review a production-specific recovery procedure against the captured baseline. The existing rollback rehearsal is fixture-scoped and must not be run against production.
5. **Schedule disposition:** each of the six legacy schedules must have a recorded decision. Default to manual-only. Generation approval and publication approval are separate decisions.
6. **Change window and operator:** have a human operator authorized to pause/resume invocation sources, observe results, and execute the approved recovery procedure.

If any precondition is missing, stop before migration.

## Proposed sequence

### Stage 0 — freeze automation entry points

- Pause all invocation sources identified in preflight, including scheduled orchestration and direct automation triggers. Verify the pause using read-only evidence.
- Do not disable or rewrite production schedules as an informal workaround; use the reviewed change plan and record before/after state.
- Confirm no in-flight generation, review, or publication worker remains active before proceeding.

### Stage 1 — apply the reviewed database migration

- Apply only the exact reviewed readiness migration after its production compatibility and rollback review is approved.
- Verify the transaction completed, the readiness column/RPCs/triggers exist, RLS and grants match the approved matrix, and every unapproved schedule is disabled with generation/publication flags off.
- Do not mark legacy schedules ready, backfill readiness, or infer provenance from the newest autonomous run.
- If any assertion fails, keep entry points paused and follow the approved recovery procedure; do not continue to Edge Function deployment.

### Stage 2 — deploy guarded leaf functions while invokers remain paused

Deploy and verify the exact reviewed branch artifacts, one function at a time, in this order:

1. \`release-publisher\` — direct publication must reject missing/ambiguous/unready automation and report success only when chapter status is actually published.
2. \`generate-chapter\` and \`revise-chapter\` — direct entry points must enforce trusted internal authentication and fail closed on missing, malformed, or active Gemini provider state.
3. AI review workers used by the orchestrator — verify the exact source/version for quality, continuity, originality, safety, and publication-review paths.
4. \`review-orchestrator\` — verify readiness and provider-state checks plus the run-local stop after a 429/503 response.
5. \`generation-orchestrator\` — verify readiness checks, provider-state rechecks, run-local throttle stop, and safe blueprint status recovery.
6. \`autonomous-series-creation-runner\` — deploy only after its readiness RPC exists and is verified.
7. \`release-scheduler\` — deploy last, after its lease RPCs, readiness checks, failure handling, and publisher status checks have been verified.

The order above is not sufficient on its own: keep all invocation sources paused until the entire set is verified. If any function deployment or verification fails, do not resume automation.

### Stage 3 — verification while automation is still paused

- Compare deployed version markers and retrieved source hashes to the approved artifacts for every changed function.
- Verify scheduler lease claim/renew/release behavior and that schedule timestamps cannot advance after failed/partial publication.
- Verify publisher idempotency and all duplicate/existing-chapter responses against actual chapter status.
- Verify readiness cannot be forged by client roles or a caller-settable session setting; verify grants at both table and column level.
- Run dry-run/read-only checks only where the endpoint's dry-run contract guarantees no mutation. Do not use a production invocation as an unreviewed smoke test.
- Verify every schedule remains disabled unless an individually reviewed disposition and approved readiness workflow explicitly authorizes it.

### Stage 4 — controlled resume

- Resume only the reviewed invocation source(s), initially in observation/dry-run mode where supported.
- Resume generation-only schedules individually after per-series approval and evidence review.
- Keep \`auto_publish=false\` for every series. The current candidate deliberately has no separate publication-authorization RPC; implementing, auditing, and testing that mechanism is a prerequisite before any publication schedule may be enabled. Do not treat generation readiness or the service-role key alone as publication approval.
- Observe at least one complete controlled cycle, including lease ownership, provider state, blueprint transitions, publication result, and \`next_release_at\` behavior, before expanding the rollout.
- Stop immediately on any invariant violation; pause all entry points and preserve logs/evidence.

## Recovery and abort conditions

Abort and keep all invocation sources paused if any of the following occurs:

- missing/mismatched schema, grant, RLS, function security, or RPC evidence;
- deployed source/version differs from the approved artifact;
- any unapproved schedule becomes enabled or gains a readiness marker;
- a worker can reach Gemini without validated provider state;
- lease ownership is missing/duplicated or stale workers continue;
- publication response says success when the chapter is not \`published\`;
- a partial publication failure advances the schedule;
- exact recovery of the pre-change function definitions and grants cannot be demonstrated.

Recovery must first leave all automation disabled. Restore exact prior function/trigger definitions and grants only from the captured production baseline. Do not use the disposable fixture rollback as a production rollback. If the prior safe state cannot be proven, leave the system disabled and escalate for a human decision.

## Current disposition

- This document is a sequencing proposal, not a record that preconditions have passed.
- Gate A catalog/ACL evidence remains blocked.
- The fixture rollback is not an exact production rollback baseline.
- Six legacy schedules still require individual disposition.
- Production deployment, migration, schedule changes, generation, and publication remain unauthorized by this review.
