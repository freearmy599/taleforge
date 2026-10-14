# Aevora Phase 1 — Server-Only Table Access Triage
Date: 2026-10-14
Status: read-only production inspection; remediation plan only. No production privileges, policies, schema, schedules, or data were changed.

## Confirmed high-priority finding

The connected database reports RLS enabled with zero policies on these tables:
- `public.publication_sync_outbox`
- `public.story_attachment_metrics`
- `public.release_schedules`
- `public.aevora_engineering_tasks`
- `public.aevora_engineering_decisions`

The Supabase security advisor currently reports 91 public-schema tables with RLS enabled and no policies. That advisor result is not, by itself, proof of data exposure: with RLS enabled and no applicable policies, row access is normally denied. However, the absence of policies must be evaluated alongside table grants and intended access.

A targeted `information_schema.role_table_grants` query returned table-level grants for `anon` and `authenticated` on `publication_sync_outbox`, `story_attachment_metrics`, and `release_schedules`, including SELECT, INSERT, UPDATE, and DELETE, plus other table privileges. This is inconsistent with the documented server-only access intent at the privilege layer, even though RLS currently has no policies. The finding should be treated as a privilege-hardening gap, not proof that client requests can currently read or mutate rows.

## Remediation order

1. **Priority 0 — server-only operational tables:** prepare a migration to remove table-level privileges from `anon` and `authenticated` on `publication_sync_outbox` and `story_attachment_metrics`; verify `release_schedules` is also server-only before changing it. Preserve the minimum privileges required by trusted server-side execution, service-role operations, triggers, and scheduled jobs.
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
