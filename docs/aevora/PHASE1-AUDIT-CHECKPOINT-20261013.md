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



### Phase 1 continuation checkpoint — 2026-10-14 latest verified batch

**Branch:** `aevora/release-scheduler-hardening`  
**Latest successful validation for the current source/test batch:** [workflow run 38515472247](https://github.com/freearmy599/taleforge/actions/runs/38515472247), commit `6bb598502b6a37ef1914ed1e5f58004c01b40aec`. Configured Edge Function type checks and the source-contract workflow passed, including provider-state grants, complete server-only table inventory, read-only access audit, and internal worker authorization contracts.

#### Branch-only access hardening prepared

- The live metadata-only query reconfirmed exactly **39 public base tables** with RLS enabled, zero policies, and direct table grants to `anon` and `authenticated`.
- Prepared branch migrations cover all 39 by explicit group: 25 internal policyless tables, 2 telemetry/outbox tables, 1 provider-state table, and 11 dormant reader-feature tables. The new source contract asserts that these groups cover 39 unique table targets. The 11 reader-feature tables are not called by the current browser HTML/JS or Edge Function source scan; their tables, FKs, triggers, and data remain intact. A stored `SECURITY DEFINER` reader-progress verifier references `reading_history`; read-only ACL metadata confirms it is not executable by `anon` or `authenticated` and remains executable by `service_role`.
- The prepared internal RPC migration covers all 12 public-schema invoker functions with current client EXECUTE, including four trigger-returning helpers. It revokes direct execution from `PUBLIC`, `anon`, and `authenticated`, preserving service-role access. The contract passed.
- A fresh sequence ACL audit found client SELECT/UPDATE/USAGE grants on `reader_events_id_seq` and `aevora_engineering_events_id_seq`, both identity sequences. A new branch-only migration revokes direct client sequence privileges while preserving service-role grants; its contract passed.
- A repeatable read-only SQL audit now covers five metadata-only queries: relation grants/policies, explicit column ACLs, schema-specific default ACLs by owner, client-executable public functions, and existing public sequence ACLs. Its contract verifies the SQL contains only SELECT statements.

#### Additional findings that remain open

- **Default privileges:** `postgres` and `supabase_admin` schema-specific default ACLs grant broad table, sequence, and function privileges to ordinary client roles for future public-schema objects. No global/default ACL change has been prepared or applied; changing those owner-scoped templates needs separate compatibility and role-ownership review.
- **Trending visibility:** `story_trending_scores` and `story_intelligence` are security-invoker views; `story_trending_scores` aggregates `reader_events`, whose only client policy is validated INSERT and which has no SELECT policy. Event-derived ranking aggregates may therefore be invisible/zero to ordinary callers. Do not expose raw reader-event rows or visitor IDs to fix this; design a narrow aggregate-only projection and test it.
- **Public system health:** the existing public status view includes `blocking_reason` and JSONB `evidence`; the audience and safe fields need explicit review before the prepared narrative-internal migration is rolled out.
- **Dispatch correlation:** the latest aggregate snapshot at approximately 05:12 UTC found the newest pg_net response at 05:05:00.365 UTC and newest cron run start at 05:05:00.312 UTC, so the previously observed freshness gap was absent in that snapshot. Request-ID correlation and HTTP/application/business-outcome separation remain open; aggregate timestamps do not prove per-job success.
- **Data API exposed schemas:** still not verified from project configuration. SQL grants and view options alone do not prove which schemas PostgREST exposes.
- **Migration drift:** the live Supabase migration inventory still ends at `20261010161919`; the prepared October 13–14 branch migrations are not present in live migration history. No migration was applied.

#### Safety boundary

All work above is repository documentation, migration source, and tests plus read-only catalog inspection. **No production migration, GRANT/REVOKE, RLS/policy/view change, deployment, queue/schedule mutation, generation, or publication was performed. No billable Supabase branch was created.** Phase 1 remains open; production rollout requires an explicit authorization and a compatibility review of the outstanding items above.

## Further Phase 1 continuation — 2026-10-14

- Added a branch-only lock migration for the 11 reader-feature tables (`bookmarks`, `collection_stories`, `collections`, `comments`, `likes`, `notifications`, `profiles`, `ratings`, `reading_history`, `recommendations`, `story_reports`). Static source review found no direct `.from(...)`/`.rpc(...)` calls to these table names in the 15 browser HTML/JS files or 28 Edge Function TypeScript sources; the current reader stores follows/bookmarks/history locally. The tables, FKs, triggers, and stored verifier remain intact. The migration revokes only `PUBLIC`, `anon`, and `authenticated`; live metadata confirms explicit `service_role` table grants remain.
- The prepared server-only migration groups now cover all 39 RLS-enabled/no-policy base tables with client grants: 25 internal policyless tables, 2 telemetry/outbox tables, 1 provider-state table, and 11 unwired reader-feature tables. A source contract checks this inventory. This is a branch-only least-privilege repair, not a production deployment.
- Prepared a branch-only migration to revoke ordinary-client privileges on `aevora_engineering_events_id_seq` and `reader_events_id_seq`. Read-only catalog metadata confirms both are identity sequences and `service_role` has explicit sequence privileges. No sequence ACL was changed in production.
- A fresh read-only catalog scan confirms 12 public-schema invoker functions currently have effective client EXECUTE: eight planner/metrics/scoring helpers and four trigger-returning helpers. The prepared migration now revokes client EXECUTE on all twelve; live metadata confirms `service_role` has explicit EXECUTE on all twelve. No function was invoked or changed in production.
- The trending-view audit found `story_trending_scores` and `story_intelligence` are `security_invoker=true`, while `reader_events` has only a validated client INSERT policy and no SELECT policy. Since `stories.html` queries `story_trending_scores` for Explore ranking, event-derived scores/counts are likely invisible to client queries. Do not expose raw `reader_events`; a narrowly allowlisted aggregate view or trusted RPC needs a separate security design and regression tests.
- The dispatch-response freshness gap was **not present** at a later read-only snapshot: at 05:10 UTC, latest pg_net response and latest cron SQL run were within 0.02 seconds, and the active scheduled jobs had zero failed SQL runs in the six-hour window. Per-request correlation and Edge Function business success remain unverified; no test dispatch or job change was made.
- The reusable `docs/aevora/phase1-readonly-access-audit.sql` now checks relation grants, explicit column ACLs from `pg_attribute.attacl`, schema-specific default ACLs by owner, effective client-executable functions, and existing sequence ACLs. The full-schema catalog check found zero explicit column ACL entries for `PUBLIC`, `anon`, or `authenticated`; the confirmed issue is relation/default ACLs, not independent column ACLs.
- Latest completed source/type-contract validation: [run 38515482123](https://github.com/freearmy599/taleforge/actions/runs/38515482123), commit `eba0c5973be0ba47a7f63b60d00cb7d4d6bcf806`, **success**. Live migration history remains at `20261010161919`; the October 13–14 repair migrations remain unapplied. The Data API exposed-schema configuration and intended public health-status fields still require confirmation.
- No production migrations, grants/revokes, RLS/view changes, deployments, queue/schedule changes, generation, or publication were performed. No billable Supabase branch was created. Phase 1 remains open.

## Trending and diagnostic-view hardening — 2026-10-14

- Prepared `20261014130000_public_trending_aggregate_rpc.sql`: a fixed-`search_path`, parameterless `SECURITY DEFINER` aggregate function returns the existing 12-column per-series trending contract, and the `story_trending_scores` view remains `security_invoker=true`. Raw `reader_events` SELECT remains denied by RLS; the aggregate function does not return visitor IDs or event rows. Both discovery views are now restricted to SELECT for ordinary client roles. The score remains a heuristic because events are client-submitted, not authenticated identity claims.
- Prepared `20261014150000_reader_events_insert_only.sql`: remove broad direct client relation privileges on `reader_events`, then grant only INSERT to `anon` and `authenticated`; existing INSERT RLS validation remains in place. Trusted `service_role` access is preserved.
- The narrative-internals migration now also revokes direct client privileges on `taleforge_system_health_snapshot`, which contains `blocking_reason` and JSONB `evidence`. A public status page, if desired, needs a separate allowlisted projection without those diagnostic fields.
- Latest completed source/type-contract validation on the branch: [run 38516009977](https://github.com/freearmy599/taleforge/actions/runs/38516009977), commit `d0602902527fcba94d3d5e21ff4475d2a1fb38ab`, **success**. The branch still has unapplied migration proposals; live migration history remains at `20261010161919`. No production permissions, views, policies, functions, schedules, queues, generation, or publication were changed.

## Default-ACL audit expansion — 2026-10-14

The repeatable read-only access audit now includes both schema-specific defaults outside `public` and any global default ACL entries. The live recheck found broad client defaults not only for `public` objects but also schema-scoped entries under Supabase-managed schemas including `storage`, `graphql`, `graphql_public`, and `realtime`. These were inventoried only; no default ACL or role membership was changed. Before any fix, verify which schemas are exposed through the Data API and which ACLs are Supabase-managed. Current branch validation passed: [run 38516297230](https://github.com/freearmy599/taleforge/actions/runs/38516297230), commit `a811b9300edb227b8526a289d5ffae07413d869b`.

## Scheduler production-readiness recheck — 2026-10-14

Read-only inspection of deployed Edge Function source confirms production is still on `release-scheduler` v12 and `release-publisher` v21. The live scheduler source has no calls to the lease claim/renew/release RPCs and can advance `next_release_at` after a failed/partial publish attempt. The branch scheduler source is `release-scheduler-v16-dst-fold-cadence`; it uses lease claim/renew/release, verifies persisted published status, and gates schedule advancement on confirmed completion.

**Deployment dependency:** the branch scheduler also calls `aevora_activate_story_lifecycle_if_lease_owned` and `aevora_advance_release_schedule_if_lease_owned`. A read-only catalog check confirms these two functions are **not present in production**; their definitions and restricted grants are in branch migration `20261012190000_aevora_atomic_scheduler_lease_fencing.sql`, which is absent from live migration history. The live claim/renew/release functions exist and are service-role-only, but that does not satisfy the two missing atomic RPC dependencies. Do not deploy the branch scheduler until the migration set is reviewed, ordered, approved, and applied with a post-migration preflight. No function or migration was deployed during this recheck.

## Publisher production-readiness recheck — 2026-10-14

Read-only inspection of deployed `release-publisher` v21 confirms the branch repair is not yet live. The deployed existing-chapter path returns `success: true` without requiring the existing chapter to be `published` or matching the approved generation output; its duplicate-race path also returns success without checking the raced chapter's status/content. The deployed version also lacks the branch's explicit eligible-generation-status check. This can misreport a non-published/conflicting chapter as a successful release.

The branch publisher uses `isPublishableGenerationStatus` and `matchesPublishedOutput`, verifies the persisted chapter is actually published, and only reports success when synchronization/canonical outbox status is confirmed. The source/type-contract suite is passing, but the publisher repair remains branch-only. Do not deploy it separately from the scheduler/lease migration dependency plan; no production function was changed during this check.

## Deployed-function source-of-truth inventory — 2026-10-14

A read-only comparison found 26 deployed Edge Functions but only 19 function `index.ts` sources in this repository branch. Seven deployed functions are absent from the branch source tree: `chief-editor-monitor` v8, `autonomous-series-creation` v5, `aevora-operations-snapshot` v5, `autonomous-series-creation-runner` v6, `aevora-cover-worker` v4, `aevora-cover-request` v5, and `aevora-cover-review` v4. The inspected live versions contain handler-level admin/owner checks or an internal scheduler-credential path; this is not the same as source-controlled CI coverage. Before Phase 1 can claim reproducible deployment, either bring these exact deployed sources under version control and add contracts, or document their separate repository/deployment ownership. No source was copied from production and no deployment was performed.


## Default-ACL scope correction — 2026-10-14

This note supersedes any earlier sentence in this checkpoint that grouped `realtime` with schemas where broad ordinary-client default privileges were confirmed. The latest owner-aware `pg_default_acl` query found schema-specific client grants under `public`, `storage`, `graphql`, and `graphql_public`; the inspected `realtime` entries did **not** show `anon`/`authenticated` grants. Global defaults owned by `supabase_admin` also did not show those client grants. Treat these as catalog snapshots, not proof that each schema is exposed through PostgREST or that every future object is reachable. Verify the Data API exposed-schema configuration and Supabase-managed ownership before proposing any default-ACL change. No default ACL, role membership, or production permission was changed.

## Current source-control coverage blocker — 2026-10-14

The deployed-function comparison found 26 deployed Edge Functions but only 19 `index.ts` sources in this repository branch. The seven deployed functions absent from this source tree are `chief-editor-monitor`, `autonomous-series-creation`, `aevora-operations-snapshot`, `autonomous-series-creation-runner`, `aevora-cover-worker`, `aevora-cover-request`, and `aevora-cover-review`. This is a reproducibility/CI-coverage gap, not by itself evidence that their deployed handlers are vulnerable. Before claiming Phase 1 is fully source-controlled, add verified source ownership for each or explicitly document the separate deployment repository and validation path. Do not copy production code into this branch without provenance and review.

## Live internal worker authorization gap — 2026-10-14

The dedicated audit `PHASE1-LIVE-INTERNAL-EDGE-AUTH-AUDIT-20261014.md` records 18 deployed internal workers (versions 4–59 depending on function) that all have `verify_jwt=true` but no handler-level trusted-caller check in their live source. Supabase's gateway JWT check is not role authorization; the branch's shared internal-key guard is now source-tested for all 18 workers. Active cron jobs 3–7, 9, and 10 include the trusted key in the `apikey` header; job 13 uses a separate service-role-token/admin guard in its live-only runner. No endpoint was probed and no production function was deployed. Current branch validation passed at [run 38517164971](https://github.com/freearmy599/taleforge/actions/runs/38517164971), commit `986c96651fe0983f1f7cb642decfd3109c7e7976`.

## Revision-successor migration preflight blocker — 2026-10-14

A read-only aggregate preflight for `20261013140000_aevora_revision_successor_idempotency.sql` found one parent-output group with multiple approved successors; there are no groups with multiple published successors. The migration is designed to abort on multiple approved successors, so it is **not currently safe to apply**. Its ranking/update step would otherwise change two rows' statuses to rejected. The unique index is not present in production. No output IDs, chapter content, or row payloads were queried, and no data was modified. Manual editorial review must identify the intended approved successor before the migration can be re-preflighted; do not bypass the migration's abort guard or auto-select a winner.

## Provider-state migration preflight — 2026-10-14

A read-only aggregate check found one Gemini provider-state row with a diagnostic that the prepared `20261013120000_lock_ai_provider_state_table.sql` would redact; one Gemini row currently has an active cooldown. The migration changes diagnostic text and client grants, but does not clear or shorten the cooldown. No diagnostic contents were queried, no provider state was changed, and no generation/review call was triggered. Preserve the active cooldown during any later approved migration.


## Current hardening checkpoint — 2026-10-15

### Latest verified source-validation state

- The latest successful workflow at this checkpoint is [run 38719462429](https://github.com/freearmy599/taleforge/actions/runs/38719462429), commit `d41901d227f402999b1e3b3fa059392294f88af3`. Both prepared Edge Function/source-contract validation and the disposable PostgreSQL rehearsals passed, including reader-event integrity and trending aggregate state/ACL assertions.
- Browser-facing RPC-boundary coverage now rejects computed RPC function names so the inventory/denylist cannot be bypassed with a variable argument. This is source-level prevention; it does not itself prove that production browser bundles or deployed functions have changed.
- Public trending has been deliberately gated closed on the repair branch. `get_public_story_trending_scores()` and both `story_trending_scores` and its dependent `story_intelligence` view are granted only to `service_role`; public `anon`/`authenticated` access is not enabled. This avoids advertising a public API that still lacks trusted intake and anti-abuse controls, and avoids a misleading grant on a security-invoker view whose dependency remains private.
- Static contracts and disposable PostgreSQL ACL assertions now check the closed gate for both views. The latest green run confirms these branch tests/type checks, not a Supabase-managed production ACL change.

### Still blocking production release

1. **Publication approval principal/source is unresolved.** The authorization design remains proposal-only. Do not invent the trusted human approver identity or authentication source; publication remains fail-closed.
2. **Production default-privilege ownership gap remains.** Some default ACL entries are owned by `supabase_admin`; the current audit executor may not have authority to repair them. Any live repair requires a separately authorized owner-level operation.
3. **Six legacy schedules remain HOLD / NOT APPROVED.** The disposition register still needs a fresh authorized read-only inventory and explicit per-series decisions. No schedule IDs or approvals should be inferred from template slots A–F.
4. **Reader-event abuse controls remain incomplete.** Relationship validation, optional event UUIDs, and server timestamps reduce invalid links, repeated same-key inserts, and timestamp spoofing, but do not stop fresh-UUID spam or spoofed visitor IDs. Keep trending closed until trusted intake and reviewed per-visitor quotas/cooldowns and abuse-case tests exist.
5. **Public discovery-view access is intentionally unavailable on this branch** until a public-safe projection and abuse controls are reviewed. This is a product behavior trade-off made to preserve the fail-closed security boundary, not a production change.

### Explicit safety boundary

All changes in this checkpoint are repository-only. No production migration, grant change, Edge Function deployment, live schedule mutation, generation, publication, or billable Supabase branch was initiated. Production rollout remains **NO-GO**.


## Trending integration rehearsal checkpoint — 2026-10-15

- Added a guarded disposable-PostgreSQL fixture and runner for the trending aggregate migration. The script refuses to run unless `AEVORA_DISPOSABLE_TRENDING_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE` is set and requires an explicit `DATABASE_URL`.
- CI now applies the aggregate migration to an isolated database and executes SQL assertions for current follow/unfollow and bookmark/unbookmark state, future-dated events, recent opens, and the closed ACL contract.
- Added adversarial events with a chapter from a different series and with an unpublished chapter. The integration assertions verify that these do not inflate recent opens or active follows, covering the extra validation required because the aggregation function is `SECURITY DEFINER`.
- The fixture models client reader-event access as INSERT-only (not SELECT) and checks that `anon` and `authenticated` cannot select either ranking view or raw reader events, while `service_role` retains the necessary read access.
- Verified CI run [38716707701](https://github.com/freearmy599/taleforge/actions/runs/38716707701) succeeded on commit `3b2cc62f7159b4688a4a2e3bd56568564a11b2d6`, including both prepared Edge Function type checks and the disposable PostgreSQL rehearsal.
- This adds branch-level runtime coverage for the proposed migration; it does not establish that the migration is applied to production or resolve the separate live default-privilege ownership issue. Production remains **NO-GO**.


### Rehearsal harness guard verification — 2026-10-15

- Added `scripts/aevora-trending-rehearsal-safety-contract.test.mjs` and wired it into the Edge validation workflow.
- The contract checks the explicit disposable opt-in, the required database URL, fixture → migration → assertion ordering, INSERT-only client event grants, and the CI target being the named localhost PostgreSQL test database.
- Updated pull-request path filters so changes to the trending fixture and rehearsal runner trigger this workflow.
- After correcting the test to identify the final workflow step robustly, [CI run 38717122460](https://github.com/freearmy599/taleforge/actions/runs/38717122460) passed both the source/type-check job and the disposable PostgreSQL rehearsal on commit `49d5eb10652cdfd546f5546d85bf1aa09bb6866e`.


### Follow-up verification — 2026-10-15

- The disposable trending rehearsal now seeds invalid bookmark events pointing to a chapter in another series and to a draft chapter; active bookmark count must remain one. The static RPC contract checks the bookmark CTE's matching-series and published-chapter joins.
- The published-library loader documents and preserves graceful fallback when the intentionally gated `story_intelligence` view is unavailable. The home/library query can still return published series and chapters without intelligence enrichment; trend-derived ranking/classification may be absent until the public-safe API is approved.
- [CI run 38719014756](https://github.com/freearmy599/taleforge/actions/runs/38719014756) passed after these changes. This is repository-only verification. Public trending remains unavailable to `anon` and `authenticated` on the branch; no production change was made.

- A new reader-event source contract verifies that direct browser INSERTs remain centralized in `reading-progress.js`, the `track(event_type, data)` compatibility seam carries the optional idempotency key, and the browser does not set `created_at`. The first CI attempt exposed an over-escaped test regex; it was corrected and the full workflow passed in run 38719462429.


### Trusted reader-event quota rehearsal — 2026-10-15

- The branch now has a server-only reader-event intake RPC with per-visitor-hint limits of 30/minute and 1000/day, event/relationship validation, idempotency, and a private quota store. The Edge Function is prepared but not deployed; the browser still uses direct INSERT and can bypass the new quotas until the browser cutover and direct-write revocation are staged together.
- A concurrent test initially failed because the stress fixture reused UUIDs from the sequential quota test. The duplicate outcomes were expected; the test was corrected to use a separate UUID namespace. [CI run 38738581910](https://github.com/freearmy599/taleforge/actions/runs/38738581910) then passed both jobs, including 30 accepted / 1 limited under 31 concurrent requests.
- Cleanup was further bounded: the RPC checks a singleton cleanup gate, uses a non-blocking advisory lock only when the one-minute window expires, and deletes at most 1000 expired quota rows per cleanup attempt. An initial SQL assertion attempted to inspect the private state as `service_role`; it was moved to the migration-owner test context. [CI run 38738919711](https://github.com/freearmy599/taleforge/actions/runs/38738919711) passed both source/type-checking and disposable PostgreSQL rehearsal.
- This verifies branch behavior only. No production migration, function deployment, direct-write revocation, or public trending access was enabled. Production remains **NO-GO**.


### Reader-event intake cutover preparation — 2026-10-15

- Added a branch-only browser switch that preserves `window.taleForgeProgress.track(event_type, data)`. When enabled, it sends JSON to the public reader-event Edge Function and does not fall back to direct INSERT if intake fails. It is deliberately disabled by default; direct INSERT remains available during compatibility, so the quotas are not yet a complete anti-abuse boundary.
- Added a function-specific Supabase config with JWT verification disabled only for this public telemetry endpoint. The handler performs its own bounded payload validation and calls the service-role-only atomic RPC; service-role credentials remain server-side.
- The browser switch, no-fallback contract, SQL cleanup cooldown, and type annotations for newly exposed strict TypeScript errors all passed [CI run 38739996092](https://github.com/freearmy599/taleforge/actions/runs/38739996092). Both prepared Edge/source validation and disposable PostgreSQL rehearsal are green.
- Remaining before any cutover: deployed endpoint smoke test, enable flag in a controlled release, verify telemetry/rollback, then separately revoke ordinary-role direct INSERT. No production action was taken; trending remains closed and production remains **NO-GO**.


### Reader-event endpoint behavioral verification — 2026-10-15

- Extracted a dependency-injected request handler so Deno tests can exercise the public intake boundary without calling a live Supabase project or exposing credentials. Coverage includes body/method/content validation, payload allowlisting, UUID/progress validation, no-RPC-on-invalid requests, RPC field mapping, stable outcome codes, and redacted failures.
- Added the handler suite to the required CI workflow. During the same pass, strict TypeScript checks surfaced implicit/unknown inference in generation buffer callbacks, review maps, world-element ID maps, and publication review rows; explicit structural types fixed these without changing business behavior.
- [CI run 38740534812](https://github.com/freearmy599/taleforge/actions/runs/38740534812) passed both Edge/source validation and disposable PostgreSQL rehearsal on the current branch head. This remains branch-only; the intake flag is disabled by default and direct INSERT is not yet revoked.
