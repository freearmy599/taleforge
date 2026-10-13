# Aevora Phase 1 — Production Drift Audit
Date: 2026-10-12
Scope: Read-only production inspection; prepared repair branch only.

## Executive result

**Do not deploy the prepared scheduler/publisher replacement yet.** The repair branch has a successful hosted validation run, but the deployed functions are materially older than the prepared code. Branch CI proves the branch's source contracts; it does not prove production has those protections.

- Repository: `freearmy599/taleforge`
- Prepared branch: `aevora/release-scheduler-hardening`
- Latest validated branch commit: `b2ee3de7a6d9f5b9e3506241b5b06266255add36`
- Latest hosted CI run: [38274956230](https://github.com/freearmy599/taleforge/actions/runs/38274956230) — scheduler/publisher type-check and source-contract regression tests passed.
- Production Edge Functions remain unchanged during this audit.
- No migrations, schedule changes, chapter publishing, secret access/rotation, billable branches, or deployment were performed.

## Follow-up source hardening on 2026-10-12

- Published chapter history parsing now accepts only integer numbers or plain decimal digit strings before safe-integer/range validation. This prevents JavaScript coercions such as `true`, `[1]`, hexadecimal strings, exponent strings, and decimal-form strings from being interpreted as plausible chapter numbers.
- Regression coverage was added for those malformed input classes while retaining plain decimal-string compatibility.
- Hosted validation run [38274956230](https://github.com/freearmy599/taleforge/actions/runs/38274956230) completed successfully on commit `b2ee3de7a6d9f5b9e3506241b5b06266255add36`.
- This is prepared-branch-only source hardening. Production remains unchanged; no database writes, migration applications, schedule changes, chapter generation/publication, secret changes, or deployments were performed.

## Confirmed live/prepared source mismatch

Production metadata reports `release-scheduler` version 12 and `release-publisher` version 21. Reading the actual deployed function source shows older internal source markers (`release-scheduler-v5-contiguous-approved-release` and `release-publisher-v5-outbox`), while the prepared branch contains the hardened scheduler and publisher handlers.

The live scheduler source does not contain the prepared branch's internal API-key check, lease claim/renew/release flow, publication-review qualification before selecting outputs, full published-history gap guard, cooldown recovery guard, strict publisher response confirmation, or database confirmation that a returned chapter is published. The live publisher source does not contain the prepared branch's internal API-key check, generation-status eligibility guard, or exact existing-chapter identity/status guard.

This is source divergence, not proof of a currently exploitable endpoint: both deployed functions report `verify_jwt=true`, and the cron authentication path still needs a controlled, explicitly authorized end-to-end verification before any deployment decision.

## Read-only production data findings

- Six enabled release schedules were observed; all six have `auto_publish=false`. Do not change them as part of repair preparation.
- One schedule for **The House That Grows Rooms** has a stale `next_release_at` of 2026-10-06 and no `last_release_at`; investigate its generation/lifecycle state before considering any schedule mutation.
- Current published chapter numbering gaps:
  - **The Clockwork Sky:** chapters 10, 16, and 18 are missing while later chapters are published.
  - **The Last Unsent Letter:** chapter 3 is missing while later chapters are published.
  - **After the Red Eclipse:** chapters 3, 10, and 11 are missing while later chapters are published.
- A read-only query found six generation outputs marked `approved` with no publication-review row. These must remain ineligible for automatic publication until they receive a real review with all four gates explicitly true.
- The database currently reports 62 rows with `status='published'` across the whole chapters table; this is a count of published chapter rows, not a claim that all series are contiguous.
- Supabase security advisors currently report 91 tables with RLS enabled but no policies. Some may be intentionally service-only; triage by table access requirements before making any policy changes. Do not apply blanket policies.

## Subsequent branch-only hardening — 2026-10-12

The prepared scheduler now rejects malformed JSON, non-object request bodies, non-string or blank explicit `schedule_id` values, and non-boolean `dry_run` values before constructing schedule queries or attempting lease claims. Valid explicit schedule IDs are trimmed before query scoping. Source-contract tests assert caller authentication precedes client initialization and that request validation precedes database reads and lease side effects.

Verification evidence:
- Commit `13539bf3e35f4b65596a3f0b0d61e8469fe7f2f6`: source validation workflow passed after strict `dry_run` validation.
- Commit `fde29aec564624b12a7421f9e9428ddcbf3acab9`: source validation workflow passed with the additional ordering contract for authentication, request validation, database reads, and lease claims.

These are prepared-branch type/source-contract checks only. They do not prove full runtime integration or production behavior. No production deployment, migration, schedule mutation, chapter generation, or publication was performed by these commits.

## Additional quota-protection verification — 2026-10-12

A fresh read-only inspection of active Edge Function source found that several earlier quota-guard concerns are no longer current for the active versions inspected:
- `generate-chapter` v59 checks Gemini provider state in both the chapter-generation and quality-review paths, and blocks when the lookup errors or the cooldown is active.
- `review-orchestrator` v11 blocks with HTTP 503 when provider state errors or the Gemini row is missing.
- `revise-chapter` v40 has a provider-state check before its revision model-call paths.

One concrete remaining gap was found in `generation-orchestrator` v35: its `getGeminiCooldown` helper treated a successful lookup with no provider-state row as inactive. An invalid non-empty cooldown timestamp could also compare as inactive. The orchestrator did not immediately stop on its initial lookup's `lookup_error` field before deterministic planning refresh work.

Prepared branch repair:
- Restored the exact active v35 `generation-orchestrator` source into source control because the function was absent from the branch tree.
- Changed provider-state lookup to fail closed for lookup errors, missing rows, and invalid cooldown timestamps.
- Added an immediate retryable HTTP 503 response before request processing, deterministic refresh, schedule iteration, or AI-dependent work when provider state is unavailable.
- Added the function to branch CI type-checking and source-contract regression tests.

Validation evidence: workflow run [38280010050](https://github.com/freearmy599/taleforge/actions/runs/38280010050) completed successfully after the map typing correction. This proves the branch's Deno type checks and source-contract tests passed; it is not a live integration test. Production function versions and configuration remain unchanged.

Additional read-only review found a second issue in active `generation-orchestrator` v35: `dry_run=true` still called deterministic-intelligence refresh RPCs, rebuilt advanced chapter plans, updated exhausted revision statuses, and invoked `taleforge_select_revision_strategy`, which inserts/updates `taleforge_revision_selections`. Therefore the existing diagnostic mode was not read-only.

Prepared branch repair now:
- Skips deterministic-intelligence refresh, advanced chapter-plan build, and revision-exhaustion status updates during dry runs.
- Reuses previously stored revision-selection rows through a read-only query rather than invoking the mutating selection RPC.
- Leaves generation, revision, and review calls behind the existing dry-run early exit.
- Returns `read_only: true` and lists skipped mutation classes when dry-run is selected.
- Adds source-contract tests for the no-mutation guarantees.

Validation evidence: workflow run [38280268489](https://github.com/freearmy599/taleforge/actions/runs/38280268489) passed the expanded source-contract suite and type-checks, including the restored generation orchestrator. This is branch-only validation; the active production generation orchestrator remains unchanged until a separately authorized deployment.

A further review of active `review-orchestrator` v11 found that its top-level cooldown response returned HTTP 200 with `success: true` and `blocked: true`. Although the payload communicated the block, callers that rely on HTTP success could misclassify the skipped review as successful. The prepared branch restores the exact active source and changes this cooldown response to HTTP 429 with `success: false`, `blocked: true`, and `retryable: true`, so callers cannot confuse a skipped review with a successful review. CI run [38280548722](https://github.com/freearmy599/taleforge/actions/runs/38280548722) passed the expanded type-check and regression suite. Production remains unchanged.

## Safe next sequence

1. Keep the repair branch isolated and preserve the passing CI run.
2. Complete source-level review of scheduler, publisher, and shared internal API-key validation.
3. Verify cron-to-Edge authentication in a controlled way without exposing or rotating secret values and without weakening `verify_jwt`.
4. Add/complete a non-mutating integration verification path for review gates, leases, stale schedule handling, publication confirmation, and chapter gaps.
5. Re-audit the three published-history gaps and six reviewless approved outputs; do not auto-publish or fabricate missing chapters to make counts contiguous.
6. Only after explicit deployment authorization, deploy in a controlled sequence and verify live source/version and safe dry-run behavior. Do not enable `auto_publish` as part of that deployment.

## Stop conditions

Stop and report rather than making a production change if verification requires reading secret values, changing JWT verification, modifying cron credentials, creating a billable Supabase branch, changing release schedules, publishing chapters, applying schema changes, or merging to the default branch.

## Request-scope hardening follow-up — 2026-10-12

A further branch-only source review found malformed request bodies could silently become unscoped batch runs in the generation and review orchestrators. An explicit JSON `null`, invalid JSON, or invalid identifier types could otherwise trigger work across multiple outputs/schedules instead of rejecting the request.

Prepared-branch changes now:
- Reject malformed/non-object request bodies in the generation and review orchestrators.
- Reject explicitly supplied null, blank, or non-string series/schedule/output IDs rather than degrading to an unscoped run.
- Require boolean values for `dry_run` and `review_after_generation` when supplied.
- Align scheduler diagnostics with the documented policy: only a targeted dry run may inspect a disabled schedule; real runs and unscoped dry runs remain limited to enabled schedules.
- Reject an explicitly null scheduler `schedule_id`, preventing an unintended unscoped batch invocation.

Validation evidence: [workflow run 38282486239](https://github.com/freearmy599/taleforge/actions/runs/38282486239) passed scheduler, publisher, generation-orchestrator, and review-orchestrator Deno type-checks plus source-contract regression tests on commit `434bc51ef6c010c31cf69843fa5910fd2efc4def`.

These changes are branch-only and do not establish live runtime integration or production behavior. No deployment, migration, schedule mutation, chapter generation, or publication was performed.

## Provider cooldown timestamp validation — 2026-10-12

The branch's review orchestrator previously treated a malformed non-empty `cooldown_until` timestamp as if no cooldown were active because an invalid date compares as `NaN`. It now returns a retryable HTTP 503 and blocks review model calls whenever that timestamp is malformed, matching the generation orchestrator's fail-closed provider-state behavior.

Validation evidence: [workflow run 38282606264](https://github.com/freearmy599/taleforge/actions/runs/38282606264) passed all prepared Edge Function type-checks and source-contract regression tests on commit `ebcf8793b2678f93acc50cf1a32c660d735e3261`.

This remains branch-only source validation; production is unchanged.

## Atomic scheduler lease fencing — branch validation passed

Read-only production SQL inspection recovered the exact claim/renew/release lease function definitions, their restricted grants, and the lease/schedule table columns. The branch now prepares an additional migration with two transactional RPCs: one fences release-deadline advancement and the other fences lifecycle activation. Each locks the lease row, checks the exact token and expiry, uses a fixed security-definer search path, and restricts execution to postgres/service_role. The scheduler now uses these atomic RPCs instead of a lease-renewal request followed by a separate schedule/lifecycle write.

Validation evidence: [workflow run 38283233964](https://github.com/freearmy599/taleforge/actions/runs/38283233964) passed all four Edge Function type checks and all 37 source-contract tests on commit `e6186e4fd5853e271272d65e8ec0f7eaf13d7d28`. The SQL contract also rejects a release deadline that does not advance beyond the recorded completion timestamp.

The lease foundation source migration has now been reconstructed from the exact live table/RPC definitions and ACLs and is committed at `supabase/migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql`, before the atomic fencing migration. Both migrations remain **prepared only** and have not been applied. Contract tests cover the recovered table/function security and ownership/expiry semantics. This is source-level reproducibility plus type/contract validation, not production integration validation, and does not authorize deployment.

## Repeatable read-only publication integrity audit

Added `docs/aevora/phase1-readonly-integrity-audit.sql` as a source-controlled, SELECT-only audit for future controlled verification. It reports published chapter-number gaps, duplicate published chapter slots, approved outputs with missing/non-unique/non-passing publication reviews, and enabled auto-publish schedules overdue by more than 24 hours. It does not mutate rows or attempt automatic repair.

The query has been committed to the hardening branch but has **not** been executed against production. Its findings must be reviewed before any data repair; it is not a deployment or migration.

### Read-only query execution result — 2026-10-12

Executed the audit query directly against the configured Supabase project using SELECT-only SQL. The query completed without errors and returned:
- **7 published chapter gaps** across three ongoing series: *The Last Unsent Letter* (chapter 3), *After the Red Eclipse* (chapters 3, 10, 11), and *The Clockwork Sky* (chapters 10, 16, 18).
- **6 approved generation outputs without a publication-review row**, spanning chapter numbers 14, 15, 16, 21 (two outputs), and 25.
- **0 duplicate published chapter slots** in this snapshot.
- **0 enabled auto-publish schedules overdue by more than 24 hours** under the audit's defined threshold.

No rows were inserted, updated, or deleted; no schedule was changed; no chapter was generated or published. The six reviewless outputs remain ineligible for publication under the prepared review-qualified scheduler/publisher path. The seven gaps need a separate story/blueprint reconciliation before any data repair; do not fabricate or auto-publish replacement chapters merely to fill the numbers.

### Gap reconciliation — existing story assets found

A second SELECT-only query joined each of the seven missing published slots to its existing chapter blueprint and generation outputs. **All seven gaps already have a blueprint and at least one output**; there is no evidence here that a new blueprint or chapter should be fabricated. The latest output statuses are `generated` for *The Last Unsent Letter* chapter 3 and *After the Red Eclipse* chapter 3; `quality_check` for *After the Red Eclipse* chapters 10–11 and *The Clockwork Sky* chapters 10 and 18; and `generated` for *The Clockwork Sky* chapter 16. Older attempts for Clockwork Sky chapters 10, 16, and 18 include `needs_revision`.

Safe next repair is to trace why these existing outputs remain non-publishable, verify review/revision state and generation-job linkage, and resume only through the normal guarded pipeline after review eligibility is established. No generation or status change was initiated during this reconciliation.

### Existing review/job state for the seven gaps

Further SELECT-only checks show the current output rows for these gaps have no linked `generation_job_id`, and there are no matching `generation_jobs` rows for those series/chapter slots. Review state is incomplete rather than publish-ready:
- The two *After the Red Eclipse* outputs at chapters 10 and 11 and *The Clockwork Sky* outputs at chapters 10 and 18 have a single passing **quality** review (score 92) but no publication-review row; this is not equivalent to passing continuity, originality, safety, and publication gates.
- *After the Red Eclipse* chapter 3 and *The Last Unsent Letter* chapter 3 have no `chapter_reviews` rows.
- *The Clockwork Sky* chapter 16 has a newer `generated` output with no review rows and an older `needs_revision` output without a review row; chapter 10 and 18 also retain older `needs_revision` attempts.

No job was enqueued and no review/model function was invoked. The correct next step is a guarded, one-output-at-a-time review/revision recovery plan after verifying the production review-orchestrator's deployed version and quota guard; the current branch's review fixes are not yet deployed.

## Privileged orchestration authentication hardening — 2026-10-12

A source-level review found that the prepared `generation-orchestrator` and `review-orchestrator` constructed Supabase service-role clients without checking the caller's `apikey`. With gateway JWT verification alone, a valid publishable/anon JWT can satisfy JWT validation; the handler must still enforce its own server-to-server authorization before using elevated credentials. This is particularly sensitive for generation orchestration, which can initiate expensive model work and mutate workflow state.

Prepared-branch repair:
- Both orchestrators now validate the request `apikey` using the existing shared `isTrustedInternalApiKey` helper before constructing the privileged client.
- The check accepts the legacy service-role key for existing internal calls and newer secret keys only when their names are explicitly allowlisted in `AEVORA_INTERNAL_API_KEY_NAMES`.
- Untrusted or missing keys receive HTTP 401.
- Regression tests now assert that scheduler, publisher, generation orchestrator, and review orchestrator authenticate before client creation.

No JWT verification setting was changed. This is branch-only source hardening; production handlers remain unchanged pending explicit deployment authorization.

Validation evidence for the privileged-handler authentication repair: [workflow run 38285648719](https://github.com/freearmy599/taleforge/actions/runs/38285648719) passed all four prepared Edge Function type checks and the expanded source-contract suite on commit `5c6cf5ecebd1375786e2793e055dbde027bbff5c`. The audit SQL was also executed read-only from its committed source and completed successfully. Neither result is a production deployment or live Edge Function integration test.

## Publication-review decision and endpoint boundary — 2026-10-12

Read-only inspection of deployed `publication-review` v8 confirmed it intentionally returns HTTP 200 with `success: true` for both approved and rejected review decisions; the actual outcome is expressed by `decision`, `eligible`, `generation_status`, and the four gate results. The prepared review orchestrator previously treated any 2xx response as a successful publication-review step. It now requires `decision=approved`, `eligible=true`, `generation_status=approved`, and all four gate `passed` flags to be true; otherwise the output result is marked blocked.

The same read-only source review found that deployed `publication-review` v8 does not contain the shared handler-level internal API-key guard used by the prepared scheduler/publisher/orchestrators. Its gateway currently reports `verify_jwt=true`, which is not a substitute for checking the expected server-side caller. The function can update publication-review and generation-output state, so it remains a separate endpoint-hardening item before a broader rollout. It is not included in the current branch because the live source needs a clean, reviewed source-control recovery rather than a risky whitespace transformation of the returned source.

No production function was changed or invoked. Keep the rollout blocked until this remaining endpoint guard and the cron-to-gateway authentication behavior are addressed through the authorized source/configuration workflow.

Validation evidence for the publication-review response fix and lifecycle lock adjustment: [workflow run 38286371683](https://github.com/freearmy599/taleforge/actions/runs/38286371683) passed all four prepared Edge Function type checks and **39 source-contract tests** (0 failures) on commit `90010ffbffeaa461f6f1115a5304e1b0b906f193`.

### Wider privileged-endpoint authentication inventory — 2026-10-12

A read-only inventory of deployed Edge Function metadata and handler source found that these active functions report `verify_jwt=true` but lacked handler-level validation of the expected server-side `apikey` while constructing privileged Supabase clients and/or performing model-dependent work:

- `generate-chapter` v59
- `revise-chapter` v40
- `continuity-review` v10
- `originality-review` v9
- `safety-review` v9
- `publication-review` v8

The current branch now includes a source-controlled snapshot of `generate-chapter` v59 with the shared internal-key guard before privileged client creation, plus fail-closed checks for missing provider-state rows and malformed cooldown timestamps in both generation and quality-review paths. The remaining four review/revision endpoints (`revise-chapter`, `continuity-review`, `originality-review`, `safety-review`) and `publication-review` still need controlled source recovery and the same explicit internal-key validation before a safe broad rollout. Gateway JWT validation alone does not establish that the caller is a trusted internal service. Do not weaken `verify_jwt` to work around this; preserve it until cron/internal authentication is verified end-to-end. No function was deployed or invoked as part of this inventory.

Validation evidence for the `generate-chapter` repair: [workflow run 38286805866](https://github.com/freearmy599/taleforge/actions/runs/38286805866) passed all five prepared Edge Function type checks and **40 source-contract tests** (0 failures) on commit `4187e939bd5c07bc776c69ccf659a49b7f860b1c`.

### Remaining malformed-cooldown gaps in deployed review/revision functions

The same read-only source inventory found a related fail-open edge case in deployed `revise-chapter` v40 and review handlers `continuity-review` v10, `originality-review` v9, and `safety-review` v9. They fail closed when provider-state lookup errors or the row is missing, but a malformed non-empty `cooldown_until` timestamp is converted to an invalid Date and compared with `Date.now()`; that comparison is false, so the guard may proceed as if no cooldown exists. `revise-chapter` also has a helper that treats this malformed timestamp as inactive.

This is not repaired in the current branch because those deployed source snapshots are not in source control and the retrieved copies are heavily whitespace-corrupted; reconstructing them by blindly trimming source could alter prompt strings. Recovery and precise handler patches remain required before Phase 1 can be considered fully quota-safe. The prepared `generate-chapter`, generation orchestrator, and review orchestrator now fail closed on missing/invalid provider state.


## Generation-orchestrator claim fencing — 2026-10-12

A source-level concurrency review found that generation failure and exception paths could update a chapter blueprint to `rejected` by ID alone, potentially overwriting a newer state written after the worker's claim. The successful-output path similarly changed the blueprint status without confirming it remained `generating`. The prepared branch now conditionally fences all three transitions with `.eq("generation_status", "generating")`, so stale workers cannot overwrite a blueprint that another process has moved to a different state. Source-contract tests cover the failure, exception, and successful-output transitions, alongside the existing atomic claim guard.

Validation: [workflow run 38287411189](https://github.com/freearmy599/taleforge/actions/runs/38287411189) completed successfully on commit `0bc63b46d9949b63293081fd86132bb97e1cb44a`; the five prepared Edge Function type checks and source-contract regression suite passed. This is source-level validation only; no production function was deployed and no database or schedule state was changed.


## Controlled review/revision endpoint source recovery — 2026-10-12

A fresh read-only retrieval of the active Supabase Edge Function metadata/source confirmed these deployed versions and source hashes:

- `revise-chapter` v40 — `d187fc6977e6a442f7bf85afa4f3216cb3723cd6e7b0683839108a6a2f669614`
- `continuity-review` v10 — `1bf17f4f4d9ab7a1c3064a53133ee50461dd2732584b6a8ce195df484e177e15`
- `originality-review` v9 — `b132a55e1a49a88edd14f33c9b37997d4f4b364174385451537644abbb74d3cb`
- `safety-review` v9 — `c5cb78f5a015c748a6f4cdf87e64c5fd5cbaf992698be36825babea16f0f219d`
- `publication-review` v8 — `bbd7addb82c4f231c0a109dcd284c073d39c2921118d3440bb3fb9803c5004ef`

All five currently report `verify_jwt=true`, but none of the retrieved sources contains the shared `isTrustedInternalApiKey` handler guard. The cooldown paths in `revise-chapter` v40, `continuity-review` v10, `originality-review` v9, and `safety-review` v9 compare parsed dates without rejecting malformed non-empty timestamps. The revision helper also reads cooldown state without checking its query error or missing row. These are confirmed live-source findings, not assumptions about the prepared branch.

The retrieved source payloads are heavily whitespace-corrupted and exceptionally large, so they are not safe to copy into the repository and patch with broad string substitutions: doing so could damage prompts or alter generation/review behavior. The safe next step is controlled, reviewable source recovery for each endpoint, with tests and type-checking, before any production rollout. No endpoint was deployed or changed in this audit; JWT settings were not changed.


## Follow-up hardening on 2026-10-13

- Fixed generation-buffer accounting in `supabase/functions/generation-orchestrator/index.ts`: the buffer now counts only the newest generation output for each chapter, rather than allowing a superseded older `generated`/`approved` output to keep that chapter counted as active after a newer output has moved to a non-active state.
- The latest-output map is now shared by the revision-backlog check and active-buffer calculation, keeping those decisions consistent.
- Added a source-contract regression test that checks the latest-output accounting and rejects the previous all-rows counting pattern.
- Validation: [workflow run 38331745555](https://github.com/freearmy599/taleforge/actions/runs/38331745555) passed all prepared Edge Function type checks and the source-contract regression suite.
- This is branch-only source hardening. No production deployment, migration, schedule mutation, chapter generation, publication, secret access, or billable Supabase branch was performed.

- Additional 2026-10-13 fix: generation orchestration now checks database errors when marking revision attempts as exhausted. If any status write fails, that schedule is explicitly blocked and reported as retryable instead of silently continuing with stale revision state. A regression test covers the failure path. [Validation run 38331815087](https://github.com/freearmy599/taleforge/actions/runs/38331815087) passed all prepared Edge Function type checks and source-contract tests.

- Additional 2026-10-13 fail-closed guard: if generation orchestration cannot read the latest published chapter number for a series, it now blocks that schedule with a retryable diagnostic instead of silently treating the published boundary as chapter zero. Added a regression test. [Validation run 38331893577](https://github.com/freearmy599/taleforge/actions/runs/38331893577) passed all prepared Edge Function type checks and source-contract tests.


## Follow-up hardening and validation — 2026-10-13

The prepared release publisher was further hardened after the prior audit notes above:

- Revalidates the series lifecycle, blueprint identity, approved generation-output state, publication-review decision, and all four publication gates immediately before inserting a chapter.
- Fences generation-output and blueprint synchronization updates by their eligible states and checks that the expected row was actually affected, including the concurrent duplicate-insert path.
- Corrects the duplicate-race response so synchronization flags are true only when both the write succeeds and the target row is confirmed.
- Stops claiming canonical synchronization was queued when this handler has not confirmed an outbox insert or worker invocation. The response now reports `queued: false` and `status: "not_enqueued"`, with an explicit warning. This is honest status reporting, **not a completed canonical-sync implementation**.

The initial repository tree scan of the prepared branch and default branch did not find the worker, so no speculative schema wiring was added. A subsequent read-only live Supabase inspection **did confirm** the existing production components: `publication-sync-processor` v4 and `post-publication-canon-sync` v6, both configured with `verify_jwt=true`. The live `publication_sync_outbox` schema includes the expected event/status/retry fields, and the observed snapshot contained 40 events, all `succeeded`. The active processor cron job is named `taleforge-publication-sync` and runs every five minutes.

That live inspection also found both handlers lack the explicit `isTrustedInternalApiKey` guard present in the hardened Aevora handlers. The prepared branch now recovers both live handler sources and adds handler-level server-key validation. The processor additionally stops silently ignoring stale-recovery errors, excludes events at the eight-attempt ceiling from automatic re-claim, and verifies outbox completion/retry state writes before reporting those states. The canon-sync handler validates request shape and verifies the chapter is actually published **before** invoking continuity workers. Validation: [workflow run 38339566048](https://github.com/freearmy599/taleforge/actions/runs/38339566048) passed all seven configured Edge Function type checks and **51 source-contract tests** (0 failures) on commit `f2ba74933419576a161d6f38c8d66c29951242fa`. These changes remain branch-only; production handlers and cron configuration remain untouched.

The publisher's first-publication timestamp update remains conditional on `published_at IS NULL`; write errors are surfaced as warnings, while a concurrent write that already set the timestamp is not treated as a failed publication. A regression contract now covers the three publisher paths.

Validation evidence:
- [Workflow run 38338532035](https://github.com/freearmy599/taleforge/actions/runs/38338532035) passed 48 source-contract tests and all configured Edge Function type checks on commit `a27e8c5ec75b080d5bcadbf42aaf518d5f281221`.
- [Workflow run 38338886643](https://github.com/freearmy599/taleforge/actions/runs/38338886643) passed 49 source-contract tests and all configured Edge Function type checks on commit `d40b8d112701c16a80e51468b0e500981122a98f`, including the first-publication timestamp regression contract.

These are prepared-branch type/source-contract checks, not production integration proof. Production remains unchanged: no deployment, migration, live schedule mutation, chapter generation/publication, secret access/rotation, or billable Supabase development branch was initiated. Phase 1 remains open.
