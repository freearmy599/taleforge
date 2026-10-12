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

The migration remains **prepared only** and has not been applied. Existing production claim/renew/release function definitions still lack their original source migration in the repository, so full schema reproducibility remains incomplete. This result is not production integration validation and does not authorize deployment.

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
