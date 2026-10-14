# Aevora Phase 1 — Server-Only Table Access Triage
Date: 2026-10-14
Status: read-only production inspection; remediation plan only. No production privileges, policies, schema, schedules, or data were changed.

## Newly confirmed highest-priority exposure candidate

A broader read-only privilege inventory found **120 public tables with grants to `anon` and/or `authenticated`**, with 756 grant rows per role across the inspected result and 1,272 grants for elevated operations (INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES). This is a schema-wide least-privilege problem and cannot be safely solved by blanket revocation until tables are classified.

Two tables stand out as urgent because RLS is disabled while both client roles have full table privileges and there are no policies:
- `public.story_intelligence`
- `public.story_trending_scores`

For each table, the database reports both `anon` and `authenticated` with SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES. With RLS disabled, these grants are materially more concerning than the policyless-but-RLS-enabled tables. If the `public` schema is exposed through PostgREST (common but not confirmed in this audit), these privileges may allow unauthenticated reads and writes through the API. Actual API reachability and any additional platform protections remain unverified; treat this as a **potential critical exposure requiring prompt owner-led containment review**, not as a confirmed exploit.

No matching branch migration filename was found for locking these two tables. The deployed migration inventory also ends at version `20261010161919` (`aevora_release_scheduler_leases`); the intended server-only migrations dated October 13 are absent. This indicates the live schema has drifted from the branch's intended hardening and requires a migration reconciliation plan, not an assumption that branch fixes are already deployed.

## Immediate containment plan (approval required)

1. In the Supabase Dashboard, verify Data API exposed schemas and any API gateway/network controls. Do not send probes or mutate data to test reachability.
2. Inspect the intended product role for `story_intelligence` and `story_trending_scores`. If they are internal-only, prepare a narrowly scoped migration to enable RLS and revoke `PUBLIC`, `anon`, and `authenticated` table privileges; preserve trusted backend access and any legitimate reader-facing views/functions.
3. Review whether these tables contain sensitive/internal narrative intelligence or ranking data before deciding if exposure requires incident handling.
4. Extend the table-by-table matrix to all 120 tables. User-facing tables such as bookmarks, comments, profiles, likes, ratings, and reading history need intentional owner-scoped policies rather than indiscriminate server-only revocation.
5. Have the project owner approve any production grant or RLS changes. This inspection made no production changes.

## Confirmed high-priority finding

The connected database reports RLS enabled with zero policies on these tables:
- `public.publication_sync_outbox`
- `public.story_attachment_metrics`
- `public.release_schedules`
- `public.aevora_engineering_tasks`
- `public.aevora_engineering_decisions`

The Supabase security advisor currently reports 91 public-schema tables with RLS enabled and no policies. That advisor result is not, by itself, proof of data exposure: with RLS enabled and no applicable policies, row access is normally denied. However, the absence of policies must be evaluated alongside table grants and intended access.

A targeted `information_schema.role_table_grants` query returned table-level grants for `anon` and `authenticated` on `publication_sync_outbox`, `story_attachment_metrics`, and `release_schedules`, including SELECT, INSERT, UPDATE, and DELETE, plus other table privileges. This is inconsistent with the documented server-only access intent at the privilege layer, even though RLS currently has no policies. The finding should be treated as a privilege-hardening gap, not proof that client requests can currently read or mutate rows.

The branch already contains intended revocation migrations: `20261013090000_aevora_server_only_metrics_outbox_grants.sql` for the outbox and metrics tables, and `20261013130000_lock_internal_policyless_tables.sql` for `release_schedules` and other internal tables. A read-only query of `supabase_migrations.schema_migrations` did not find those migration versions. This is consistent with the observed live grants, but migration-history absence alone should be reconciled with the project's deployment process before deciding whether to apply anything.

## Remediation order

1. **Priority 0 — reconcile existing migration drift:** review the two already-prepared branch migrations against the live schema and migration history. If they are still the approved intended fix, arrange an explicitly authorized migration window for `20261013090000_aevora_server_only_metrics_outbox_grants.sql` and `20261013130000_lock_internal_policyless_tables.sql`. Preserve the minimum privileges required by trusted server-side execution, service-role operations, triggers, and scheduled jobs.
2. **Privilege matrix:** inventory grants for every table flagged by the advisor, grouped by schema/table/grantee/privilege. Classify each table as public-read, authenticated-user scoped, or server-only before choosing policies or grants.
3. **RLS regression tests:** add checks that the two explicitly server-only tables have RLS enabled, have no client-facing policies, and grant no table privileges to `anon` or `authenticated`. Test intended trusted-role access separately.
4. **API exposure:** verify the actual PostgREST exposed-schema list through supported project configuration. Do not infer reachability solely from SQL grants.
5. **Apply only after approval and compatibility review:** production DDL/GRANT changes are deliberately not included in this branch-only finding.

## Why not add deny-all policies instead?

No-policy RLS currently provides a default deny for row access, but explicit privilege minimization is still the correct server-only contract. Adding a policy without first resolving grants can accidentally broaden access later. Avoid broad grants and avoid indiscriminate revokes across unrelated tables.

## Dispatch correlation and freshness remain open

Cron dispatch jobs execute SQL successfully, but this does not prove the corresponding Edge Function succeeded. A recent read-only log aggregate showed events from PostgreSQL, Edge, and function-edge sources through approximately 03:56–03:58 UTC during the checked window; it did not establish request-by-request correlation or explain the previously observed pg_net response freshness gap. Do not trigger test requests or mutate live schedules to investigate. Add request-ID correlation only through a reviewed change that preserves existing payloads, headers, cadence, and side effects.

## Acceptance criteria for Phase 1

- All server-only tables have explicit least-privilege grants for client roles.
- User-facing tables have documented, ownership-aware RLS policies and automated policy tests.
- No security-advisor finding is marked resolved without confirming its intended access model.
- Scheduled dispatch success is distinguished from HTTP response success and application-level business postconditions.
- A read-only audit can identify stale telemetry without making generation, publication, or queue changes.
