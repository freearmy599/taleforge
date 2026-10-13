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

- Live Supabase `revise-chapter` v40 is not present at the expected path in the repair branch, even though `generation-orchestrator` invokes it using the server key. The live handler has POST-only handling and provider-state lookup, but the audited source did not show a shared handler-level internal-key guard and did not reject malformed cooldown timestamps. It must be recovered into a manageable, normalized repository source file, patched, and type-checked before any rollout. Do not claim this path is fixed.
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
- Replaced remaining user-facing TaleForge branding with Aevora in the core narrative-planner/review prompts and narrative-engine documentation. The pipeline contract now guards against regression.
- Successful source validation confirmed at https://github.com/freearmy599/taleforge/actions/runs/38415697519 (Edge type checks and provider-state grants/redaction contract) and https://github.com/freearmy599/taleforge/actions/runs/38416351255 (Aevora prompt-brand contract). Documentation-only validation also passed at https://github.com/freearmy599/taleforge/actions/runs/38416539858.
- Live database remains unchanged. At the last read-only check, the Gemini provider cooldown was still active until 2026-10-14 09:15:26 UTC; last_error still contained a legacy raw quota response in production, which the prepared migration will sanitize only when separately authorized and applied.
- A broader security catalog audit still reports 91 RLS-enabled public tables without policies, including 39 with client-role grants. This work deliberately addresses the clearly internal provider-state table only; the remaining tables need table-by-table caller/access review rather than a blanket revoke.

**Rollout boundary remains unchanged:** no production Edge Function deployment, migration application, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Phase 1 remains open.
