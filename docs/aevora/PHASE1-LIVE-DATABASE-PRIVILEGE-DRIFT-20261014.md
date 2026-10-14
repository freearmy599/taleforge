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
