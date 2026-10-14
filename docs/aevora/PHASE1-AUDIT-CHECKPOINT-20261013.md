# Aevora Phase 1 — audit checkpoint (2026-10-13)

## Latest verified branch validation

Repair branch: `aevora/release-scheduler-hardening`

Latest successful workflow observed: [run 38342939683](https://github.com/freearmy599/taleforge/actions/runs/38342939683), commit `53fe999d38de6e300a7b479e4d0459582c28d9ba`. Source-contract tests: **59 passed, 0 failed**. The configured Edge Function type-check workflow completed successfully. Two preceding failures were caused by an overly strict source-contract assertion for the continuity-review guard; the assertion was corrected and the later runs passed.

## Additional quota protection confirmed on the branch

- `generate-chapter` checks provider state in both generation and quality-review paths and fails closed for missing/error state or malformed cooldown timestamps.
- `generation-orchestrator` validates cooldown timestamps, fails closed on missing/invalid provider state before orchestration, and rechecks before each schedule.
- `continuity-review`, `originality-review`, and `safety-review` now reject malformed non-empty cooldown timestamps rather than treating invalid dates as expired.
- Regression tests cover malformed cooldown state, and semantic continuity dry-run now returns before queue-claim mutation.
- Continuity handlers and the recovered semantic extraction worker have branch-only internal caller guards; no production deployment was made.

## Remaining confirmed drift / rollout blockers

- Live Supabase `revise-chapter` v40 has now been reconstructed into `supabase/functions/revise-chapter/index.ts` on the repair branch and hardened for internal-caller authorization, malformed cooldown timestamps, quota-state persistence, provider-error redaction, selected-strategy handoff, failed-attempt accounting, and revision commit conflicts. The live v40 still has no shared handler-level internal-key guard and does not reject malformed cooldown timestamps; it also retains legacy raw provider-error handling. This is a branch-only repair, not a production fix, until a separately authorized deployment is performed.
- Live handlers still have gateway JWT verification enabled. Branch-level internal-key checks are defense in depth, not proof of production protection until deployed and caller paths are verified.
- Safe end-to-end scheduler/publisher/outbox verification remains pending; do not invoke live jobs just to test.
- The previously documented chapter-number gaps, approved generation outputs lacking publication-review rows, stale schedule, and table-by-table RLS/grant review remain open.
- Existing RLS-enabled tables without policies need individual access-path review. Do not add blanket policies to silence the audit.

## Safety boundary

This checkpoint and its source changes are repository-only. No production function was deployed or edited; no migrations, live schedule changes, chapter generation, or publication were performed. No billable Supabase development branch was created.


## Read-only database privilege audit (2026-10-13)

A fresh read-only catalog query found **169/169 public tables have RLS enabled**, **91 have no policies**, and **39 of those 91 still grant table privileges to `anon` and `authenticated`**. With RLS enabled and no applicable policies, those grants do not by themselves bypass row security; they are nevertheless unnecessary exposure and should be reviewed individually.

The highest-priority confirmed mismatch is that both `publication_sync_outbox` and `story_attachment_metrics` have **all table privileges** (DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) granted to `anon` and `authenticated`, despite the intended server-only contract. A branch-only migration was prepared at `supabase/migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql` to revoke those client grants while retaining RLS and adding no client policies. It has **not** been applied to production.

Next RLS step: classify the other 37 no-policy tables with client grants by intended audience and actual callers; do not bulk-revoke them without checking app/Edge Function dependencies, and do not add blanket policies.


### Default-privilege root cause discovered

The catalog audit also found default table ACL entries in schema `public` that grant every table privilege (including SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) to both `anon` and `authenticated`, recorded under both the `postgres` and `supabase_admin` grantors. This explains why many tables inherit broad client grants even when RLS is enabled.

Do **not** change those schema-wide default privileges as part of an automatic patch: it can alter behavior for future tables and should be planned alongside an explicit per-table grant policy. The current branch migration only revokes grants on the two confirmed server-only tables. A separate strategic decision is needed before changing global defaults.


### Public-read policy review — internal engine tables

The policy catalog also showed unrestricted public SELECT policies on internal continuity state, reconciliation evidence, narrative-memory snapshots, narrative-thread state/events, novelty evaluations, and system dependency/health/registry tables. Several expose `before_state`, `after_state`, evidence JSON, candidate payloads, or memory payloads; these are engine internals rather than reader-facing chapter content.

A second branch-only candidate migration, `supabase/migrations/20261013103000_lock_internal_narrative_intelligence_tables.sql`, drops the specifically observed public-read policies and revokes `anon`/`authenticated` table privileges for those 13 internal tables. It creates no replacement client policies. **Not applied to production.** Before any rollout, verify that no public-facing UI intentionally consumes these internals; if a legitimate use exists, expose a narrowly scoped safe view instead of restoring broad table reads.


## Latest validation after RLS migration contracts

The source-contract suite now also checks both server-only grant revocation and internal narrative-table policy lockdown. Latest successful source/test run: [38344611237](https://github.com/freearmy599/taleforge/actions/runs/38344611237), commit `9b15088e52e3b9658d0fc9c62dc87579990d1393`, **62 passed / 0 failed**; configured Edge Function type checks passed. The canonical server-only grant migration is `20261013090000_aevora_server_only_metrics_outbox_grants.sql`; a redundant duplicate migration was removed and the regression test now targets the canonical file. The subsequent documentation-only commit records that both target tables have RLS enabled and zero policies while broad client grants remain in production.


### Public RPC execution audit

A read-only catalog check found 134 `SECURITY DEFINER` functions in `public`; **zero** are executable by `anon` or `authenticated`, and all checked privileged functions remain executable by `service_role`. That part of the existing hardening is holding.

The same audit found 12 non-definer functions executable by client roles. Seven planner/metrics functions were confirmed as internal-use RPCs; a branch-only migration `supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql` revokes client EXECUTE on those seven while preserving service-role access. A regression contract covers the list. This migration is not applied to production.

Default EXECUTE grants for future functions are also present under `postgres` and `supabase_admin`, so global default-privilege changes remain a separate strategic task; current prepared changes are limited to the known internal functions.


### Fresh follow-up — 2026-10-13

- The live privilege query confirmed both `publication_sync_outbox` and `story_attachment_metrics` still grant broad table privileges to `anon` and `authenticated`; a separate catalog query confirmed RLS enabled and zero policies on each.
- A read-only migration-history query found no rows for migration versions `20261013090000` or `20261013100000`. No migration was applied in this work session.
- The canonical branch migration revokes `PUBLIC`, `anon`, and `authenticated` privileges only on the two confirmed server-only tables. The other 37 no-policy tables with client grants remain table-by-table triage; reader-facing tables such as bookmarks/comments/profiles must not be bulk-revoked without checking intended access paths.
- Current latest follow-up documentation commit is pending CI; do not call Phase 1 complete until that run passes and remaining production drift is addressed under explicit authorization.


### Continued hardening — 2026-10-13

- Recovered and added the missing revise-chapter worker to the repair branch, then hardened its quota cooldown handling, selected-strategy prompt handoff, deterministic validation failure status, attempt-limit bookkeeping, and revision-commit conflict handling.
- Hardened generation-orchestrator so blueprint transitions are checked and compare-and-set fenced, exhausted revision states use database-allowed statuses, unresolved revision selection fails closed, dry-run reports planned exhaustion without writes, and latest outputs are selected deterministically.
- Added regression coverage for these state transitions and expanded the Edge validation workflow to run the new contract tests and trigger when Aevora regression scripts change.
- Prepared migration 20261013120000_lock_ai_provider_state_table.sql: it enables RLS, revokes all client-role table privileges from PUBLIC, anon, and authenticated, and sanitizes legacy raw Gemini quota diagnostics while retaining cooldown metadata. This migration is NOT applied.
- A further read-only catalog check verified 15 clearly internal CEO/control-plane, generation-context, continuity-queue, hybrid/inversion, novelty, and story-opportunity tables each have RLS enabled, zero policies, and broad client-role grants. Migration 20261013130000_lock_internal_policyless_tables.sql revokes those client grants for this curated list only; it adds no policies and is NOT applied.
- Replaced remaining user-facing TaleForge branding with Aevora in the core narrative-planner/review prompts and narrative-engine documentation. The pipeline contract now guards against regression.
- Successful source validation confirmed at https://github.com/freearmy599/taleforge/actions/runs/38415697519 (Edge type checks and provider-state grants/redaction contract) and https://github.com/freearmy599/taleforge/actions/runs/38416351255 (Aevora prompt-brand contract). Documentation-only validation also passed at https://github.com/freearmy599/taleforge/actions/runs/38416539858.
- Live database remains unchanged. At the last read-only check, the Gemini provider cooldown was still active until 2026-10-14 09:15:26 UTC; last_error still contained a legacy raw quota response in production, which the prepared migration will sanitize only when separately authorized and applied.
- A broader security catalog audit still reports 91 RLS-enabled public tables without policies, including 39 with client-role grants. This work deliberately addresses the clearly internal provider-state table only; the remaining tables need table-by-table caller/access review rather than a blanket revoke. Existing branch migrations also prepare targeted revokes for publication_sync_outbox and story_attachment_metrics, but none of these migrations have been applied; production still retains the current grants until an explicitly authorized rollout.

**Rollout boundary remains unchanged:** no production Edge Function deployment, migration application, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Phase 1 remains open.

### Revision successor idempotency — 2026-10-13 follow-up

- A read-only production query found one source output with three direct revision successors (two marked `approved`, one `generated`); none is currently marked `published`, and no source group has multiple `published` successors. The source has two approved successors, so the hardened migration now deliberately aborts until a human reconciles the approved candidates; do not apply the migration before that review.
- Prepared migration `20261013140000_aevora_revision_successor_idempotency.sql` ranks existing successors by lifecycle status and recency, marks losing non-published duplicates `rejected` without deleting history, aborts if a source has multiple published or approved successors, requiring manual reconciliation for ambiguous approved candidates, and adds a partial unique index for non-rejected successors. Rejected successors are excluded so the revision worker's intentional retry path remains available.
- `revise-chapter` now maps a concurrent unique-index conflict (Postgres `23505`) to a safe HTTP 409 response instead of exposing database diagnostics.
- Added `scripts/aevora-revision-idempotency-contract.test.mjs` and wired it into the branch validation workflow. The latest run for this change, [38420691074](https://github.com/freearmy599/taleforge/actions/runs/38420691074), passed the configured Edge type checks and source-contract tests, including revision idempotency and internal-worker authorization contracts.
- The migration remains unapplied. No production rows were modified, no function deployed, and no chapter generated or published.



### Retryable Gemini overload hardening — 2026-10-13 continuation

- Extended the generation, revision, planner, continuity, and review workers to distinguish Gemini quota exhaustion (HTTP 429) from temporary provider overload (HTTP 503). Temporary overloads use a shorter one-hour cooldown; quota exhaustion retains the escalating cooldown policy.
- Cooldown persistence now preserves a longer existing expiry and fails closed rather than overwriting malformed stored cooldown timestamps. Outward provider failures use stable retryable reasons and sanitized diagnostics.
- Fixed chapter-revision continuation formatting so continuation prompts and joined prose use actual newline escapes rather than literal backslash sequences.
- Updated the source-contract suite to cover these behaviors and keep version assertions aligned with the current worker revisions.
- Latest successful branch validation: [workflow run 38427289152](https://github.com/freearmy599/taleforge/actions/runs/38427289152), commit `59166bf0d1cb3fdac41a96a964d5108a613545e8`. All configured Edge Function type checks passed; the Deno source-contract run passed 72 tests and the Node contract suites passed 38 tests (**110 total, 0 failures**).
- This validation is source/type checking only; it is not a live Supabase integration test. The revision-successor idempotency migration and the prepared server-only privilege migrations remain unapplied, and the hardened Edge Functions remain undeployed. Production drift and previously documented table-by-table RLS/grant triage remain open.

**Safety boundary:** this continuation changed repository source/tests/docs only. No production function was deployed, no migration applied, no schedule changed, no chapter generated or published, and no billable Supabase branch created.


### Revision attempt-limit follow-up — 2026-10-13

- Added an independent attempt-limit check inside `revise-chapter`. Direct/internal callers can no longer bypass the orchestrator's `generation_attempt < 3` filter and spend additional Gemini quota on exhausted outputs.
- Updated the revision contracts to cover the direct-call limit and safe `revision_attempt_limit_reached` response.
- Latest successful validation: [workflow run 38427908258](https://github.com/freearmy599/taleforge/actions/runs/38427908258), commit `adc0a912fd192a463b5efe237a8d4d4c303134d7`. All configured Edge Function type checks passed, as did the 72 Deno source-contract tests and 38 Node contract tests (**110 total, 0 failures**).
- The earlier failing run was caused by a test's stale revision-version assertion after the worker version bump; the contract was updated and the subsequent run passed.

This remains a branch-only fix. No production deployment, migration, schedule mutation, chapter generation/publication, or billable Supabase branch was initiated.

### Orchestration cooldown fallback — 2026-10-13 continuation

- A follow-up source audit found that the generation orchestrator's overload/quota cooldown recorder existed but had no call sites. Wired it as a fallback for explicit provider quota/temporary-overload responses from both chapter generation and revision.
- The fallback now leaves an already-active cooldown untouched, preventing the orchestrator from double-counting a downstream worker's successfully persisted cooldown. Malformed state still fails closed, and provider-state lookup failures are not misclassified as provider overload.
- Added contract assertions for both fallback call sites and the no-double-count behavior.
- Latest successful branch validation: [workflow run 38431920592](https://github.com/freearmy599/taleforge/actions/runs/38431920592), commit `b623d2e287f74d57b6edf37985740540fdfa08aa`. All configured Edge Function type checks and source-contract suites passed, including pipeline redaction, review error-redaction, scheduler/publisher security, revision worker security/idempotency, provider-state grants, and internal worker authorization.
- This remains a repository-only hardening step. The separate live/production drift, pending migrations, deployment gates, and table-by-table RLS/grant review remain open.

**Safety boundary unchanged:** no production deployment, migration application, schedule mutation, chapter generation/publication, or billable Supabase branch was performed.

### Latest continuation — 2026-10-13, CI-confirmed

- Rechecked the current branch and confirmed `revise-chapter` is present as `revision-v18-null-safe-attempt-state`; the prior missing-worker finding is no longer current.
- Fixed failed-revision attempt bookkeeping for legacy rows whose `generation_attempt` is NULL. The compare-and-set now explicitly matches NULL rows while retaining stale-state fencing for non-NULL counters. Added regression assertions and aligned the revision version markers.
- Made Gemini cooldown recording monotonic in continuity/originality/safety review workers: an existing longer cooldown is not shortened, malformed existing expiry values are preserved, and temporary overload uses the safe short-cooldown path.
- Redacted raw database exception details from chapter-generation and review-worker provider-state logs; added source-contract checks for this behavior.
- Corrected a stale Deno contract assertion that still expected the old raw “no provider-state row” diagnostic after logs were sanitized.
- Latest successful validation: [workflow run 38433979510](https://github.com/freearmy599/taleforge/actions/runs/38433979510), commit `7d14e6b107066fa8edb440176155627911d574bb`. Edge Function type checks passed; Deno source-contract suite passed **72/72**; Node contract suites passed **42/42** (**114 total, 0 failures**).
- Validation is branch CI only, not a live Supabase integration test. The revision-successor idempotency migration, server-only privilege migrations, and hardened Edge Function deployments remain unapplied/undeployed. The known production drift, chapter/review reconciliation, stale schedule, and table-by-table RLS/grant triage remain open.

**Safety boundary unchanged:** no production deployment, migration application, schedule mutation, chapter generation/publication, or billable Supabase branch was performed.

### Planner cooldown guard coverage — latest revalidation

- Extended the pipeline contract so all five planner/continuity workers are checked for missing provider-state fail-closed behavior, malformed cooldown rejection, and active-cooldown blocking—not just the subset previously covered.
- Validation passed on [workflow run 38434779941](https://github.com/freearmy599/taleforge/actions/runs/38434779941), commit `482ec83ded7e411d9de7c66d9f9388f8b7149477`: configured Edge Function type checks passed, Deno source-contract suite **72/72**, and Node contract suites **42/42** (**114 total, 0 failures**).

### Revision successor NULL-status edge case — 2026-10-13

- Tightened the prepared idempotency migration so rows with a NULL `generation_status` are included in duplicate reconciliation and in the partial unique index (`IS DISTINCT FROM` predicates). The worker's preflight now checks all direct successors and ignores only explicitly `rejected` rows; PostgREST `neq` would otherwise omit NULL statuses.
- Added contract coverage for both the migration predicates and worker behavior. The migration remains prepared only and has not been applied.
- Validation for the NULL-status change: [workflow run 38435465968](https://github.com/freearmy599/taleforge/actions/runs/38435465968), commit `36006197138fc7638f249755b05b33e026651312`: configured Edge Function type checks passed; Deno source-contract tests **72/72** and Node contract tests **42/42** (**114 total, 0 failures**).

### Approved-successor migration preflight — latest validation

- The idempotency migration now aborts before any reconciliation/index write if a source has multiple approved successors, as well as if it has multiple published successors. This avoids choosing between two approved chapter candidates based only on recency.
- The read-only audit found a source with two approved successors, so the migration intentionally remains blocked until a human reviews and reconciles those candidates. No production rows were changed.
- The updated migration contract passed in [workflow run 38436555300](https://github.com/freearmy599/taleforge/actions/runs/38436555300). Configured Edge Function type checks and all source/Node contracts passed.


### Weekly cadence DST-fold correction — 2026-10-13 continuation

- A focused audit found that a future reserved slot could still point to the *second* occurrence of a repeated wall-clock time during a daylight-saving fall-back. A batch completed between the two occurrences could therefore permit another batch on the same local day.
- Updated the weekly post-batch resolver to compare the completed timestamp and reserved slot by their actual local calendar date, consuming the whole day even when a second DST-fold occurrence remains in the future. A missing or stale reserved slot now also skips a later same-day occurrence.
- Added regression cases for missing reserved slots, a stale first-fold slot, and a still-future second-fold slot, while preserving legitimate next-day/next-week slots.
- Branch validation passed on [workflow run 38438561860](https://github.com/freearmy599/taleforge/actions/runs/38438561860), commit `166dd04c8defb2b59dc15a969178bd8b1b1c0991`. The configured Edge Function type checks and all configured source-contract test steps passed. A preceding run failed only because the scheduler version assertion still expected the previous marker; the assertion was updated and the subsequent run passed.
- This is repository-only hardening. No production deployment, migration application, schedule mutation, chapter generation/publication, or billable Supabase branch was initiated.

## Continued access hardening — 2026-10-14

- A fresh metadata-only inventory reconfirmed **39 public base tables** with RLS enabled, zero policies, and client table grants: 11 reader-facing candidates and 28 internal/control-plane candidates by apparent purpose. The client grant set includes DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, and UPDATE. RLS does not constrain TRUNCATE or trigger/table-level privileges; this remains a least-privilege finding, not proof that PostgREST exposes every operation.
- Prepared branch migrations now revoke both relation-level and separately granted column privileges for the 28 internal targets across the telemetry/outbox, provider-state, narrative-internal, and policyless-control-plane migrations. The narrative-internal migration now explicitly enables RLS as well as dropping known public-read policies and revoking client privileges. Source-contract tests were updated; latest completed run for that test change passed: [38513807456](https://github.com/freearmy599/taleforge/actions/runs/38513807456), commit `9169a3febb41547fe6d18a9628415f1ca7adae43`.
- Added `docs/aevora/PHASE1-CLIENT-GRANT-RLS-TRIAGE-MATRIX-20261014.md` and the repeatable read-only metadata audit `docs/aevora/phase1-readonly-access-audit.sql`. The audit covers relation grants, column grants, default ACLs for future objects, and client-executable public functions without reading application rows. The SQL audit's read-only query patterns were executed individually against the live catalog; no production state was changed.
- The public `taleforge_system_health_snapshot` view is `security_invoker=true` and exposes `blocking_reason` plus JSONB `evidence`. The prepared migration may intentionally make that view unavailable to client roles by removing underlying access; product compatibility must be confirmed before rollout. Do not restore broad access to underlying health tables.
- Follow-up effective-function metadata found 12 public-schema invoker functions with client EXECUTE. Seven named planner/metrics functions are in the prepared revoke migration; the additional `taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)` is not yet classified by caller path and remains open. Four other entries are trigger-returning functions attached to table triggers and should not be treated as proven reachable RPCs.
- The actual Data API exposed-schema configuration is still unverified. Live pg_net response freshness remains an unresolved operational observation; no test dispatch or schedule mutation was made.
- No production migration, GRANT/REVOKE, RLS/policy/view change, deployment, generation/publication, queue mutation, or schedule change was made. No billable Supabase branch was created.
- Latest branch head at the time this checkpoint was edited: `9cf29288fd533b0a9dc33808425cba2cc6489515`; its CI run is pending: [38514039991](https://github.com/freearmy599/taleforge/actions/runs/38514039991). Phase 1 remains open until outstanding compatibility/configuration items are resolved and production changes, if any, are separately authorized.

### Column-ACL interpretation correction — 2026-10-14

The first pass used `information_schema.role_column_grants` / `column_privileges` and misread their effective privilege rows as independent column-level ACLs. A full public-schema check of `pg_attribute.attacl` found **zero explicit column ACL entries** for `PUBLIC`, `anon`, or `authenticated` across tables, partitioned tables, views, and materialized views. The confirmed finding is broad relation-level grants and permissive default ACLs, not separately stored column grants. The branch migrations keep column-level revoke clauses as defensive cleanup, but prior wording suggesting explicit column ACLs were observed is superseded. The repeatable `phase1-readonly-access-audit.sql` now checks `pg_attribute.attacl` directly and includes the default-ACL owner to disambiguate entries.

