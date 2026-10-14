# Aevora Phase 1 — Server-Only Table Access Triage
Date: 2026-10-14
Status: read-only production inspection; remediation plan only. No production privileges, policies, schema, schedules, or data were changed.

## Newly confirmed public-view and underlying-policy review

A broad read-only inventory found **120 public-schema relations with grants to `anon` and/or `authenticated`**: 117 base tables and 3 views. Of the base tables, 39 have RLS enabled but no policies, and zero base tables with client grants were found with RLS disabled in this targeted inventory. The aggregate grant counts include view grants and must not be interpreted as 120 confirmed vulnerabilities. Each relation still needs classification by object type, view security mode, underlying tables, and RLS policy. RLS-enabled/no-policy tables are generally default-deny for row access, but broad grants remain unnecessary privilege and may break intended reader/writer flows.

Three names that initially appeared to have RLS disabled are actually **views** with `security_invoker=true`, not base tables:
- `public.story_intelligence`
- `public.story_trending_scores`
- `public.taleforge_system_health_snapshot`

The first two are discovery views over published series/chapters and reader-event aggregates. Their `relrowsecurity=false` is expected for views; because they are security-invoker views, access to underlying rows is governed by the caller's privileges and RLS policies. Their view grants alone do not prove the underlying data is writable or bypasses RLS. Treat them as intentional public-discovery candidates pending API exposure and view-column review, not confirmed vulnerabilities.

**A separate, concrete policy-design concern remains:** `taleforge_system_health_snapshot` selects `blocking_reason` and a JSONB `evidence` field from `taleforge_system_health`, and the current underlying table has a SELECT policy for both client roles with predicate `true`. `taleforge_system_registry` also has a public SELECT policy with predicate `true`. This may be intentional for a public status panel, but the snapshot exposes operational health/evidence fields without filtering. Review the contents and intended audience of those fields promptly. Do not query or copy row payloads during this audit.

The underlying discovery relations `series` and `chapters` have RLS enabled with public SELECT policies constrained to published/ongoing/completed content. `reader_events` has a public INSERT policy with visitor-ID length and published-content checks. These are more precise controls than the initial view-only grant snapshot suggested; their policy behavior should still be tested against the intended reader flows.

## Containment / review plan (approval required)

1. Verify the Data API exposed-schema list and any API gateway/network controls in the Supabase Dashboard. Do not send probes or mutate data to test reachability.
2. Review whether `taleforge_system_health.blocking_reason` and `evidence` contain sensitive internal diagnostics. If so, remove those columns from any public view or replace the public status view with an allowlisted projection that exposes only safe status fields.
3. Confirm `story_intelligence` and `story_trending_scores` are intended public discovery surfaces and that the security-invoker view options remain enabled.
4. Continue the relation-by-relation matrix. User-facing tables such as bookmarks, comments, profiles, likes, ratings, and reading history need intentional owner-scoped policies rather than indiscriminate server-only revocation.
5. Reconcile the missing October 13 server-only migrations separately; the finding below about outbox/metrics/schedules remains valid for those base tables.
6. Obtain owner approval before any production grant, view, or RLS changes. This inspection made no production changes.

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


## Default-privilege templates — verified 2026-10-14

A fresh read-only catalog inspection found 27 `pg_default_acl` entries. These are future-object templates, not proof of current table/function exposure. The important results are:

- In `public`, both object creators `postgres` and `supabase_admin` have schema-specific default ACLs that grant `anon` and `authenticated` broad table privileges (including SELECT/INSERT/UPDATE/DELETE and other relation privileges), sequence privileges (USAGE/SELECT/UPDATE), and function EXECUTE on newly created objects.
- Similar broad client-role templates appear for objects created by `postgres` in `storage`, and by `supabase_admin` in `graphql_public` and `graphql`. Whether those schemas are exposed through the project's Data API is not verified here.
- The global defaults (namespace OID 0) observed for `supabase_admin` do **not** grant these client roles privileges in the returned ACL. The concern is the per-schema defaults above, not a blanket claim that global defaults are unsafe.
- The `auth`, `realtime`, `extensions`, and `cron` entries in this snapshot do not show grants to `anon` or `authenticated` in their returned default ACLs; preserve platform-managed configuration and do not change these templates as part of this application audit.

This creates a **future-object privilege drift risk**: a newly created table or function can inherit client grants before anyone adds a policy or reviews whether it should be server-only. It does not, by itself, make existing objects exposed, and broad defaults are not proof that every new object is reachable through PostgREST.

### Remediation approach

1. Confirm the actual Data API exposed-schema list in Supabase Dashboard/API settings, especially whether `graphql_public` or other non-public schemas are exposed. The SQL catalog does not establish this configuration.
2. Agree on an application-owned migration-owner strategy. For new Aevora server-only tables/functions, explicitly revoke client grants in the creating migration and add contract tests. Do not blindly alter defaults owned by `supabase_admin`: Supabase/platform ownership can make changes ineffective or risky.
3. For `public`, determine whether the defaults are intentional for all future objects or only public-facing ones. If least-privilege defaults are adopted, update defaults only after verifying migration roles and explicitly granting the required access on the intended public API objects.
4. Add a migration-review check that flags new server-only objects without explicit least-privilege grants. Keep the existing read-only audit for global and per-schema default ACLs.
5. No default ACL was changed, and no production migration, grant, schema exposure setting, or API configuration was modified.
