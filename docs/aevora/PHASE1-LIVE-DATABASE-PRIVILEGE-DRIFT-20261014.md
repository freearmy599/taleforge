# Aevora Phase 1 — Live Database Privilege Drift Review (2026-10-14)

## Scope and safety

Read-only inspection of the active Supabase project `sxmbnlgufqhcwxcpcsvb`, compared with branch-only hardening work on `aevora/release-scheduler-hardening`. No SQL mutations, migrations, function deployments, schedule changes, generation, or publication were performed.

## Confirmed live findings

### 1. Identity sequence grants remain broader than intended

The live ACLs for both `public.reader_events_id_seq` and `public.aevora_engineering_events_id_seq` include `USAGE`, `SELECT`, and `UPDATE` for `anon` and `authenticated`, as well as `service_role`.

The branch contains migration `20261014120000_lock_public_identity_sequence_grants.sql` to revoke direct client privileges while preserving server-side grants. The live ACL proves that branch-only migration has not been applied to production. This is a real, concrete drift item; do not imply the repair is live.

### 2. RLS is enabled on the inspected public tables, but many are not forced

The live table inventory showed RLS enabled and `FORCE ROW LEVEL SECURITY` disabled on `public.reader_events` (owner `postgres`). This is not automatically a vulnerability: table owners and privileged server roles have different behavior, and policies/grants still matter. For server-only tables, keep direct client table privileges revoked and use narrowly scoped server access.

The security advisor reports many RLS-enabled tables with no policies. A read-only ACL cross-check found multiple no-policy tables with client table privileges. With RLS enabled and no policy, ordinary client row access is fail-closed today; however, these grants are unnecessary attack surface and can become dangerous if a policy is later added without a full access review. The intended server-only tables `story_attachment_metrics` and `publication_sync_outbox` must remain server-only.

### 3. Privileged functions need a systematic search-path and ACL audit

The live catalog contains many `SECURITY DEFINER` functions with per-function search paths beginning with `public` (some include `pg_temp`). The inspected ACLs for the returned examples were restricted to `postgres` and `service_role`, which reduces direct client invocation risk, but a public-schema search path is not the safest default for privileged code. Do not blanket-edit functions: first check function bodies, object qualification, dependencies, and deployed migration provenance, then prepare targeted branch migrations and regression tests.

### 4. Trending aggregate migration is not live

The earlier read-only check found `public.get_public_story_trending_scores()` absent from production. The proposed aggregate RPC and trending-view change remain branch-only. The live `reader_events` table has RLS enabled, not forced, and is owned by `postgres`. Any rollout still needs verification of function owner, RLS bypass semantics, grants, result-column compatibility, and event-abuse controls.

## Required next actions (branch-only until separately authorized)

1. Verify whether sequence ACL cleanup also needs matching `ALTER DEFAULT PRIVILEGES` for future sequences; do not infer that current-object revokes cover future objects.
2. Produce a full grant inventory grouped by `anon`, `authenticated`, and `service_role`; distinguish intended public read models from server-only tables and views.
3. Audit every `SECURITY DEFINER` function with `search_path=public` / `public, pg_temp`, starting with function body and grants, and write targeted tests before changing anything.
4. Continue Data API exposed-schema verification using the supported Supabase project configuration surface; `pgrst.db_schemas` was not available through the inspected PostgreSQL `pg_settings` query and that absence is not evidence that the schema is unexposed.
5. Keep migration-order, aggregate RPC, cron dispatch correlation, reader-event dedupe, and scheduler/publisher production behavior as explicit rollout gates.

## Verification status

- Live checks were read-only SQL catalog queries and Supabase metadata/advisor calls.
- No production state was changed.
- This document is an audit record, not a production fix.
- Phase 1 remains open until code, tests, and rollout evidence close the relevant gates.


## Latest advisor snapshot (2026-10-14 06:25 UTC)

The Supabase advisors were re-run read-only after the latest branch contract changes. They do not apply fixes automatically.

- **Security advisor:** 91 `rls_enabled_no_policy` findings. This is an informational lint, not 91 proven data leaks: RLS enabled without a matching policy normally denies ordinary client row access. The urgent follow-up is to pair this catalog with effective table/column grants and the intended access model, then keep server-only tables denied to `PUBLIC`, `anon`, and `authenticated`.
- **Performance advisor:** 68 unindexed foreign-key findings, 2 RLS initialization-plan warnings, 55 unused-index notices, and 1 duplicate-index warning. Do not bulk-add or drop indexes from this report. Confirm each FK's workload and existing composite-index prefixes; unused-index evidence can be misleading on a low-traffic or recently deployed project.
- The two RLS initialization-plan warnings are on `public.chief_editor_series_health` and `public.chief_editor_alerts`; the suggested policy expression shape is `(select auth.<function>())` rather than per-row evaluation. Prepare a narrow migration only after checking exact policy definitions and access behavior.
- The duplicate-index warning names `idx_taleforge_memory_consolidations_series` and `idx_taleforge_memory_consolidations_series_chapter`. Despite the advisor's wording, the names suggest one may be composite; inspect full index definitions before considering removal.

These counts are a point-in-time snapshot and are not Phase 1 closure evidence. No production mutation was performed.


## Exact default-ACL catalog check (read-only, 2026-10-14)

A focused query of `pg_default_acl` confirmed the future-object risk rather than merely inferring it from existing object grants:

- For objects created by `postgres`, the `public` schema has defaults granting `anon` and `authenticated` broad table privileges (`arwdDxtm`), sequence privileges (`rwU`), and function EXECUTE (`X`). The executor is a member of `postgres`, so the branch migration's guarded `postgres` changes are technically eligible if a future rollout is approved.
- For objects created by `supabase_admin`, the `public` schema has the same client grants on future tables, sequences, and functions. The current executor is **not** a member of `supabase_admin`; the branch migration correctly skips it, so that portion of the proposed remediation cannot close the issue by itself.
- The catalog also showed client defaults in `graphql` and `graphql_public` for `supabase_admin`, plus client defaults in `storage` for `postgres`. Do not extend a revoke blindly across managed schemas: confirm Data API exposure, Supabase-managed dependencies, and intended role behavior first.
- The query returned schema-specific ACL entries; a global default ACL was not present in the result for these roles. The migration nevertheless addresses both global and `public` schema defaults to prevent global grants from remaining an independent source of future privileges.

**Rollout consequence:** before Phase 1 can close, arrange a separately authorized operation by the owning/privileged role to review and correct the `supabase_admin` defaults on `public`, then re-query `pg_default_acl` and create disposable-object verification evidence. Do not run that operation as part of this audit. No production state was changed.


## Focused SECURITY DEFINER inventory (read-only, 2026-10-14)

A catalog query filtered public SECURITY DEFINER functions whose configured search path includes public or pg_temp, and checked effective EXECUTE privilege for anon, authenticated, and service_role. The result returned 80 rows (query cap), so this is a bounded sample, not a complete count.

- In the returned sample, anon_execute=false and authenticated_execute=false for every function; service_role_execute=true. This lowers direct client invocation exposure for those sampled functions but does not prove the whole function inventory is safe.
- The three live lease functions aevora_claim_release_scheduler_lease, aevora_renew_release_scheduler_lease, and aevora_release_scheduler_lease still report search_path=pg_catalog, public, pg_temp in production. Branch source has been tightened to pg_catalog and qualifies make_interval; this is another confirmed branch/live drift item. Coordinate it with the matching scheduler deployment and migration review.
- Other sampled internal functions commonly use search_path=public or public, pg_temp while keeping direct client EXECUTE revoked. Do not blanket-rewrite them: function body qualification, dynamic SQL, triggers, managed dependencies, and invoker expectations need per-function review.
- Follow-up: run a complete inventory without an arbitrary row cap, include overload identity (oid / pg_get_function_identity_arguments), owner, ACL, function configuration, and Data API exposure; then classify each as public RPC, trusted service-only RPC, trigger/helper, or unused. Prepare targeted fixes and source-contract tests only after classification.

This was a read-only catalog inspection. No function definitions or grants were changed.
