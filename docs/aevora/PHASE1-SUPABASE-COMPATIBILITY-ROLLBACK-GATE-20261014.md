# Aevora Phase 1 — Supabase compatibility and rollback gate

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: verification plan only; not deployed.

## Purpose

Define the evidence required to close the Supabase-specific compatibility and rollback gaps for the autonomous release-readiness candidate. Disposable PostgreSQL CI passing is necessary but does not establish that Supabase-managed RLS, grants, PostgREST behavior, Edge Function deployment ordering, or recovery are safe.

## Non-negotiable boundaries

- Do not apply the candidate migration to production as part of this gate.
- Do not deploy or change Edge Functions, schedules, cron, generation, or publication.
- Do not create a billable Supabase development branch.
- Use the existing project's read-only catalog inspection only where authorized and safe; otherwise record the check as blocked rather than infer a result.
- Keep all six existing schedules unapproved until a reviewed per-series disposition exists. Do not fabricate autonomous-run provenance or enable auto-publication.

## Gate A — Supabase catalog and API compatibility

Capture dated, read-only evidence for:

1. PostgreSQL version and whether the candidate column `release_schedules.automation_ready_at` is absent before migration.
2. RLS enabled/forced state and policies for every touched table.
3. Effective table-level and column-level privileges for `PUBLIC`, `anon`, `authenticated`, and `service_role`, especially `release_schedules`.
4. Function owner, `SECURITY DEFINER/INVOKER`, fixed `search_path`, and effective EXECUTE grants for every new/replaced RPC and trigger function.
5. Whether Supabase/PostgREST schema-cache refresh or function-signature changes are relevant.
6. Whether service-role access still works through the intended server-side path while client roles cannot set readiness or mutate protected control-plane fields.

For every check, record the exact query/command, timestamp, expected result, observed result, and evidence link. A failed or blocked query is not a pass. Never paste secrets, access tokens, or service-role keys into the report.

## Gate B — Disposable rollback rehearsal

Use a disposable PostgreSQL 17 fixture (not production and not a billable Supabase branch):

1. Restore the pre-candidate schema, function definitions, triggers, grants, and representative schedule rows from a versioned fixture.
2. Capture a baseline of schema objects, grants, trigger definitions, and schedule safety flags.
3. Apply the exact candidate migration and run all forward runtime and concurrency assertions.
4. Exercise rollback using a reviewed rollback script that restores the exact prior function/trigger definitions and grants; account explicitly for the new readiness column, private transaction-authorization table, and any readiness/approval state.
5. Re-run catalog/grant assertions and confirm no API role can mutate protected readiness state.
6. Confirm rollback leaves automation disabled whenever prior readiness/provenance cannot be established. Rollback must not blindly re-enable the six legacy schedules.
7. Re-run scheduler/publisher contract tests and migration replay from a clean fixture after rollback.
8. Repeat rollback after a simulated partial rollout and after a failed transaction; confirm no partial authorization or approval records remain.

Required artifacts: before/after schema diff, rollback script, test output, grant matrix, and a concise pass/fail report. Do not describe a forward migration replay as a rollback test.

## Gate C — Deployment compatibility review (no deployment)

Before proposing rollout, review the exact deployed versions and candidate versions of the enrollment trigger, autonomous-series runner, scheduler, generation orchestrator, direct generator, review entry points, and publisher.

Document a safe ordering that never leaves an old worker able to bypass readiness and never deploys a readiness-aware worker before the schema exists. If no safe ordering can be demonstrated, rollout remains blocked.

## Gate D — Legacy schedule decisions

For each of the six schedules, produce a private, reviewer-facing disposition record with:

- production series versus test fixture classification;
- lifecycle and quality/safety/originality evidence;
- current cadence and timezone;
- decision: manual-only, reviewed generation-only, or separately reviewed publication authorization;
- approver identity/source, reason, timestamp, and configuration snapshot.

Default to manual-only. Generation approval must not imply publication approval. The test fixture must not be enabled for production automation without a specifically recorded policy exception.

## Exit criteria

This gate closes only when all of the following are true:

- Supabase-specific RLS/ACL/function-grant checks have actual passing evidence.
- Forward migration and rollback both pass in a disposable fixture.
- Worker deployment ordering and rollback behavior are reviewed.
- Each legacy schedule has an explicit disposition, with no bulk approval.
- No production state was changed during verification.

Until then, Phase 1 remains open and production rollout is not authorized by these tests or documents.


## Read-only advisor evidence addendum (2026-10-14)

Supabase advisors were queried without applying SQL or changing project state.

### Security advisor

The `rls_enabled_no_policy` informational lint returned 91 findings. Its sample includes `public.release_schedules`, `public.story_attachment_metrics`, `public.publication_sync_outbox`, and `public.aevora_release_scheduler_leases`. RLS enabled without policies can be the intended deny-by-default state for server-only tables; this finding alone does not establish a vulnerability or prove grants are correct.

Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

### Performance advisor

- 68 unindexed foreign-key findings (INFO).
- 55 unused-index findings (INFO).
- 2 RLS initialization-plan findings (WARN): `chief_editor_series_health` and `chief_editor_alerts`.
- 1 duplicate-index finding (WARN): two indexes on `taleforge_narrative_memory_consolidations`.

References:
- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
- https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index

These are advisory inventory results only. No policies or indexes were changed; unused-index findings must not prompt automatic drops without workload evidence.

### Evidence boundary

The direct SQL catalog check remains blocked, so exact table/column grants, function security modes, and EXECUTE privileges are still unverified. Advisor results do not close Gate A. The inspected CI workflow confirms successful forward migration replay, runtime assertions, concurrency checks, and reader-event integrity/grant tests; the visible workflow steps do not establish a dedicated rollback-and-restore rehearsal. Gate B therefore remains open.

## Candidate migration rollback inventory (read-only source review, 2026-10-14)

The candidate migration was inspected at `supabase/migrations/20261014210000_release_automation_readiness_gate.sql` (blob `536e0b20c28000890641df23cb34b8653f728862`). This is a source inventory, not proof of rollback.

A rollback rehearsal must account for more than dropping `automation_ready_at`:

- **Schema:** `release_schedules.automation_ready_at`, partial index `release_schedules_ready_due_idx`, and private table `taleforge_release_readiness_authorizations` (including its RLS state and grants).
- **Replaced functions:** `taleforge_enroll_series_in_production()` and `taleforge_check_autonomous_creation_gate(...)` must be restored to their exact pre-migration definitions, not merely dropped.
- **Candidate functions:** `taleforge_lock_release_schedule_parent()`, `taleforge_revoke_ambiguous_release_schedules()`, `taleforge_protect_release_automation_readiness()`, `taleforge_mark_release_automation_ready(uuid)`, and `taleforge_guard_chapter_publication_lifecycle()` need a deliberate restore/drop disposition.
- **Triggers:** `trg_lock_release_schedule_parent`, `trg_revoke_ambiguous_release_schedules`, `trg_protect_release_automation_readiness`, and `trg_guard_chapter_publication_lifecycle` must be reconciled with the exact pre-migration trigger set and definitions.
- **Privileges:** restore the pre-migration table/column grants and function EXECUTE grants from a versioned baseline, then assert them as `PUBLIC`, `anon`, `authenticated`, and `service_role`. Do not assume the disposable fixture's grants are identical to production.
- **Data effects:** the migration intentionally disables existing unready schedules and may clear readiness/automation state through triggers. Dropping the new column cannot recover the prior values; tests must prove the rollback policy keeps schedules safely disabled unless the prior state is independently evidenced.

The migration fixture provides a minimal pre-candidate schema and an enrollment-trigger stub for disposable tests, but it is not a captured production baseline. The current migration-assertion and concurrency scripts are forward-path tests. Until a separate rollback/restore script captures and compares pre/post schema, trigger definitions, grants, and safety flags on a disposable database, **Gate B remains blocked**. No production rollback or state change was attempted.

### CI harness cross-check (2026-10-14)

The successful disposable-PostgreSQL job invokes `bash scripts/test-aevora-readiness-migration.sh`, which runs the fixture, candidate migration, and forward assertions. The same job separately invokes `scripts/test-aevora-readiness-concurrency.sh`. In workflow run [38571249545](https://github.com/freearmy599/taleforge/actions/runs/38571249545), both jobs completed successfully; the PostgreSQL job's visible step list names forward replay, runtime assertions, concurrency, and reader-event integrity/grant checks. Neither the harness source nor those visible steps performs a post-commit migration rollback/restore. This confirms the rollback gap is real, not just missing documentation.


## Rollback rehearsal implementation (2026-10-14; execution pending)

Added a fixture-scoped rollback path and wired it into the existing disposable PostgreSQL migration test runner:

- `scripts/aevora-readiness-rollback.sql` first disables all schedules and clears readiness, then removes candidate triggers/functions/index/table/column and restores the versioned fixture's pre-migration function bodies and ACLs.
- `scripts/aevora-readiness-rollback-assertions.sql` checks candidate objects are gone, the baseline enrollment trigger and creation-gate stub are restored, fixture ACLs return, and every schedule remains disabled.
- `scripts/test-aevora-readiness-migration.sh` now runs rollback and rollback assertions after the existing forward migration assertions, so the existing CI invocation exercises both directions.
- `scripts/test-aevora-readiness-rollback.sh` provides an explicit opt-in runner and refuses Supabase-hosted URLs.

Important boundary: this is a **disposable fixture rollback rehearsal**, not a production-grade rollback script. The fixture's pre-migration function bodies and grants are deliberately versioned test stand-ins; they do not prove exact production definitions or ACLs. The rollback policy intentionally does not restore any previous enabled/auto flags because provenance and approval cannot be inferred from pre-migration values. Failed-transaction recovery and Supabase-specific catalog/API behavior remain separate checks.

The runner and SQL were committed to the branch, but this environment has not run PostgreSQL locally (no `psql`/server/container runtime available), and the latest commits currently show no reported CI status. Therefore the rehearsal is **implemented but not yet verified as passing**. Gate B remains open until the CI job executes successfully and its logs are inspected; production remains untouched.


### Follow-up review — rollback ACL fidelity and static regression coverage

A second review found that replacing the fixture's autonomous-creation gate function would preserve the migration's narrowed ACL unless the fixture's original PUBLIC EXECUTE grant was explicitly restored. The rollback now restores that grant and asserts that fixture API roles can execute the baseline stub. This grant is intentionally a fixture property only; it is not a recommendation for the production function's permissions.

The readiness contract test now checks that the forward test runner includes both rollback steps, that rollback retains fail-closed schedule state, and that the standalone runner requires explicit opt-in, rejects Supabase URLs, and requires an aevora_readiness database identifier.

These are source-level regression checks. They do not substitute for actually running PostgreSQL. The branch's latest inspected commit still has no reported CI status; Gate B remains open pending an actual run and log review.


A further failure-mode review moved the schedule shutdown into its own committed transaction before rollback DDL begins. This is important because a DDL/ACL rollback error must not roll back the fail-closed schedule shutdown. The contract test now asserts this ordering. This remains source-reviewed only until disposable PostgreSQL CI executes the complete path.


The rollback assertions were extended to check the fixture baseline functions' SECURITY DEFINER and search_path attributes, not just their bodies and execute grants. This closes another class of rollback drift in the test fixture; PostgreSQL execution is still required to validate the catalog assertions.

### Disposable-target guard follow-up (2026-10-14)

The CI-invoked migration-and-rollback runner now requires the explicit marker `AEVORA_DISPOSABLE_MIGRATION_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE`, rejects Supabase-hosted URLs, and requires the database URL to identify an `aevora_readiness` disposable database. The workflow supplies the marker only for its local PostgreSQL 17 service. A source-contract test checks both the guard and workflow opt-in. This reduces accidental execution against a live database but is not a substitute for actual CI execution; the latest commit has no visible reported workflow/status result, so the PostgreSQL rehearsal remains unverified.

### Additional disposable harness guards (2026-10-14)

The readiness-concurrency and reader-event-integrity rehearsal scripts now require their own explicit opt-in markers, reject Supabase-hosted URLs, and require an `aevora_` database name. The GitHub Actions disposable PostgreSQL job supplies those markers, and the release-readiness source-contract suite checks the scripts and workflow wiring. These guard changes await a fresh CI run; the earlier successful run validates the previous migration/rollback harness revision, not these newest guard additions.

### Verification update — actual disposable PostgreSQL rollback run passed (2026-10-14)

This section supersedes earlier notes above that describe the rollback rehearsal as pending. Those notes were accurate when written; a subsequent GitHub Actions run has now executed the updated harness.

- Workflow: [Aevora Edge source validation, run 1318](https://github.com/freearmy599/taleforge/actions/runs/38587961305)
- Tested commit: `335564bf361a8615080ce7c655d66856654df41a`
- Source/type-check job: **success**. The release-readiness contract suite reported 29 tests passed, 0 failed.
- Disposable PostgreSQL job: **success** on PostgreSQL 17.
- The log explicitly reports `release readiness migration integration assertions passed`, then `release readiness rollback/restore assertions passed; all schedules remain disabled`.
- The same PostgreSQL job passed release-readiness concurrency assertions, chapter publication/completion concurrency, autonomous-creation policy concurrency, release-schedule writer concurrency, stale-worker readiness revocation, and reader-event integrity/INSERT-only grant assertions.

This closes the *execution-pending portion of Gate B*: the versioned fixture's forward migration, rollback/restore, fail-closed schedule state, and associated disposable concurrency tests have executed successfully. It does **not** close Gate A or authorize deployment. The rollback restores the fixture's versioned baseline stubs and ACLs, not a proven exact snapshot of production function definitions/grants. Supabase-specific RLS/ACL/PostgREST compatibility, exact production baseline capture, deployment ordering, failed/partial production rollout recovery, and the six per-schedule dispositions remain outstanding.

No production migration, Edge Function deployment, schedule mutation, generation, publication, or billable Supabase branch was performed for this verification.

### Follow-up verification — quota-guard regression coverage (2026-10-14)

The latest workflow run [38591144268](https://github.com/freearmy599/taleforge/actions/runs/38591144268) completed successfully on commit `2852d9980aac50cb2f85878f1fa73521e4eadd06`.

- Source/type-check job: success.
- Release-readiness contract suite: **31 passed, 0 failed**.
- Disposable PostgreSQL migration, rollback/restore, concurrency, and reader-event integrity steps: all completed successfully.
- New regression tests assert that `generate-chapter` quality review fails closed when Gemini provider state is missing, malformed, or in active cooldown, and that `review-orchestrator` rejects unsafe provider state before invoking review workers.

This improves quota-protection regression coverage. It is source-contract evidence plus disposable integration evidence; it is not a live Gemini call test and does not verify the current production Edge Function deployment matches this branch. Production rollout remains blocked by the Supabase-specific Gate A evidence, deployment-order review, exact production rollback baseline, and per-schedule disposition work described above.

### Follow-up verification — revision-worker quota guard (2026-10-14)

Workflow [38592755535](https://github.com/freearmy599/taleforge/actions/runs/38592755535) passed on commit `6487b30c65fbb837f05454885aa4fc6d1b0e9dce`.

- Source/type-check job: **success**.
- Release-readiness contract suite: **32 passed, 0 failed**.
- Disposable PostgreSQL migration, rollback/restore, concurrency, and reader-event integrity job: **success**.
- Added a regression contract proving `revise-chapter` rejects missing/error provider state, malformed cooldown timestamps, and active cooldown before request processing and Gemini revision calls.

This is static source-contract evidence plus disposable PostgreSQL integration evidence. It does not exercise a live Gemini request or prove the deployed production function is the same version as the branch. One residual operational risk remains: if a Gemini throttle response occurs but persisting the shared cooldown itself fails, this invocation stops, but future invocations may not observe a newly recorded cooldown. This must be addressed or explicitly accepted in the provider-state failure policy before quota-protection is treated as fully closed.

Production rollout remains blocked by Gate A Supabase-specific ACL/RLS evidence, exact production rollback baseline and deployment ordering, and auditable disposition of the six legacy schedules. No production change, deployment, schedule mutation, generation, publication, or billable Supabase branch was performed.


### Verification update — revision cooldown assertions strengthened (2026-10-14)

Workflow [38592872695](https://github.com/freearmy599/taleforge/actions/runs/38592872695) passed on commit `88e5aa51a7cfd53ce096fbbe468cd3e5a1290ec2`.

- Edge source/type-check job: **success**.
- Disposable PostgreSQL migration, rollback/restore, concurrency, and reader-event integrity job: **success**.
- Release-readiness contract suite: **34 passed, 0 failed**.
- Tightened the revision-worker contract to anchor its ordering assertion to the request-level provider-state query, rather than the earlier helper used to persist throttle state.
- The tests confirm source-level guard ordering and cooldown error-handling branches; they do not simulate live provider calls or prove the production deployment matches the branch.

Residual quota risk remains explicit: when a provider returns 429/503 but the shared cooldown write itself fails, the current invocation returns a blocked/retryable response, but subsequent invocations may not see a durable cooldown. This cannot be declared fully closed from static tests alone; the orchestration retry policy and durable provider-state availability need review. Production rollout remains blocked by Gate A, deployment ordering, exact production rollback baseline, and the six per-schedule dispositions. No production state was changed.

### Read-only production Edge Function inventory/source comparison (2026-10-14)

The Supabase Edge Function inventory and deployed source were inspected read-only. No function was deployed, edited, or invoked for generation/publication. This evidence confirms that branch CI does **not** imply that the hardened branch is running in production.

| Production function | Live version | Deployed source SHA-256 | Material difference found in deployed source |
|---|---:|---|---|
| `release-scheduler` | 12 | `9dfb47e3d8ae3fae2c2b2fbe885fbc58b245735d829b1e3ab0d51affa4802e8c` | Version marker is `release-scheduler-v5-contiguous-approved-release`; source contains no scheduler lease claim/renew/release calls and no `automation_ready_at` readiness gate. It transitions `story_lifecycle` to active before attempting publication; when a publisher call fails, it records `publish_failed` and breaks the inner loop, but still reaches the later `next_release_at` update, so the schedule can advance after partial publication failure. |
| `release-publisher` | 21 | `04a63046cb090b546eab6f09dad643ee30fa5c2ef1a3727c5bd4b653e3e79f2c` | Version marker is `release-publisher-v5-outbox`; source contains no `automation_ready_at` readiness gate. Existing-chapter response sets `published: true` while also returning `status: existingChapter.status`, so the response can claim publication without proving that status is `published`. |
| `generate-chapter` | 59 | `9f6d57c77bba109cd079dd9441963e3f4ab3aed6ab8e0db2aab1ff2129522131` | Provider-state lookup exists, but the deployed generation guard does not reject a malformed cooldown timestamp; branch source adds finite-timestamp validation and the internal API-key allowlist check. |
| `revise-chapter` | 40 | `d187fc6977e6a442f7bf85afa4f3216cb3723cd6e7b0683839108a6a2f669614` | Provider-state lookup and active-cooldown guard exist, but deployed source does not validate malformed timestamps and does not contain the branch's internal API-key allowlist check. |
| `generation-orchestrator` | 35 | `2f96e3cca526f2c6801860fe7b6cf5456b528ba56ed964f4d5afd71c8569f8e6` | Provider-state lookup fails closed on lookup errors, but an invalid date parses to a non-finite timestamp and the current helper does not treat that as an error; branch source adds malformed-timestamp rejection. No readiness/lease behavior from the prepared branch was observed in this deployed function. |
| `review-orchestrator` | 11 | `3a8d7b11608b26cc1bf98d2d66b9799c2602be726376c23ec9e728b68fa3a0b5` | Provider-state lookup and active-cooldown guard exist, but deployed source does not reject malformed cooldown timestamps and does not contain the branch's internal API-key allowlist check. |

These findings are a direct source comparison, not proof of external exploitability. The inventory reports `verify_jwt=true` for the listed functions, so authentication implications require a separate call-path review. Nevertheless, the missing branch controls and scheduler/publisher safety gates are confirmed deployment drift and are blockers for any automated-release rollout.

**Gate disposition:** keep automated publishing and generation rollout blocked until the deployed function versions are reconciled through a reviewed, ordered rollout plan with pre/post verification and recovery steps. Do not deploy the entire branch blindly: review each function and migration dependency, preserve the existing fail-closed schedule posture, and verify status-safe publisher behavior before any schedule is re-enabled. This inventory did not inspect or change production schedules or database grants.

Read-only source inventory performed through Supabase MCP on project `sxmbnlgufqhcwxcpcsvb`; source hashes above identify the retrieved deployed versions. No production SQL, migration, function deployment, schedule mutation, generation, publication, or billable development branch was initiated.
