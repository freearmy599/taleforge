# Aevora Phase 1 — default-ACL owner remediation note

Status: branch-only audit evidence; **no production changes authorized or performed**.

## Latest read-only role-context check — 2026-10-17

Connected to the existing Supabase project using the ordinary SQL execution surface. The current executor is `postgres`, with `rolsuper = false`.

| Target role | Membership | USAGE | SET |
|---|---:|---:|---:|
| `postgres` | true | true | true |
| `supabase_admin` | false | false | false |

This confirms the existing candidate migrations cannot administer default privileges for `supabase_admin` under the current execution context. The correct response is to stop and request an authorized owner-level operation—not to remove the guard, attempt to change managed roles, or create a paid Supabase branch.

## Default-ACL evidence and scope

A read-only catalog query found client-role default grants associated with both owner roles:

- `postgres`: schema-scoped defaults in `public` and `storage`.
- `supabase_admin`: schema-scoped defaults in `public`, `graphql`, and `graphql_public`.
- The observed schema-scoped table defaults include broad `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MAINTAIN`, `REFERENCES`, and `TRIGGER` grants to `anon` and/or `authenticated`.
- Schema-scoped sequence defaults include `SELECT`, `UPDATE`, and `USAGE` grants to client roles.
- The query did not show matching global (namespace OID 0) table/sequence default entries for these client-role grants. This does **not** make the schema-scoped grants safe; it means the existing global-default guard is not the blocker observed in this query.

Do not extend the application-schema cleanup into `storage`, `graphql`, or `graphql_public` without a separate Supabase-managed-schema impact review. Their presence in the catalog is evidence to scope carefully, not authorization to mutate them.

## Additional live function-execution audit — 2026-10-17

A fresh read-only catalog query found 12 functions in `public` executable by both `anon` and `authenticated`. All 12 were `SECURITY INVOKER` (not SECURITY DEFINER) in the inspected catalog. The existing candidate `20261013110000_restrict_internal_invoker_rpc_execution.sql` is intended to revoke direct client EXECUTE access while preserving the intended server role.

The most consequential exposed routines in this sample are:

- `apply_attachment_directives(uuid)` — updates planned/ready rows in `public.chapter_blueprints` based on attachment metrics.
- `prepare_next_chapter_blueprint(uuid)` — delegates to `apply_attachment_directives(uuid)`.
- `refresh_story_attachment_metrics(uuid)` — calculates and writes `public.story_attachment_metrics`.
- Other functions expose narrative planning/context or production-buffer data; several remaining entries are trigger functions and should not be directly callable as ordinary RPCs.

A follow-up ACL/policy check found client INSERT/UPDATE/DELETE table grants on `chapter_blueprints`, `chapter_generation_outputs`, `story_attachment_metrics`, `story_blueprints`, `story_lifecycle`, `series`, and `chapters`, but no applicable client write policies on several of these tables. RLS therefore blocks ordinary row writes where no policy applies, but the grants are still broader than necessary. The public chapter/series SELECT policies are distinct from write authorization.

Important nuance: the inspected routines are invoker-security functions, so their behavior is bounded by the calling role's table privileges and RLS. Do not describe these findings as a confirmed RLS bypass. The immediate action is to keep the client EXECUTE-revocation candidate and table-ACL hardening candidates unapplied but release-blocking until the disposable rehearsals prove that triggers still run correctly, client direct RPC calls are rejected, server workers retain required access, and intended public read functions remain available where required.

## Why the current default-ACL candidate stops

The candidate `20261014170000_restrict_public_default_privileges.sql` attempts schema-scoped revocation for both `postgres` and `supabase_admin`, then raises an exception if the current executor cannot administer a target owner. The companion maintenance-default candidate has the same owner-context constraint.

That fail-closed behavior is intentional. A migration that stops at the first unauthorized owner is not proof that earlier or later default ACLs were repaired. Do not split, weaken, or mark the migrations complete without a rehearsed, auditable execution strategy.

## Required safe path

1. Keep the current migrations unapplied in production.
2. In a disposable PostgreSQL rehearsal database, model the two owner roles and schema-scoped default grants, including the non-superuser executor and the expected permission failure.
3. Determine which authorized Supabase-supported owner-level administrative surface can safely alter `supabase_admin` defaults. Do not assume `SET ROLE`, membership, or SQL-editor privileges that have not been demonstrated.
4. Design the application-owned `public` repair separately from any managed-schema work. Preserve least privilege and explicitly assert intended future table/sequence behavior.
5. Rehearse success and failure paths, including what happens if one owner can be changed and another cannot. Record rollback/recovery steps.
6. Keep function EXECUTE revocation, table write-ACL cleanup, and default-ACL cleanup as separate testable controls. Verify trigger behavior and intended public read RPCs after revocation.
7. Only after rehearsal, prepare a reviewed execution plan for explicit approval. This note does not authorize production changes.

## Release impact

This remains a Phase 1 hardening blocker. Existing table ACL cleanup and future-object default ACL cleanup are separate requirements. The current public-table maintenance grants remain a direct integrity concern because RLS does not prevent `TRUNCATE`. Do not report Aevora's production ACL posture as repaired based on candidate SQL or green branch CI alone.

## Safety boundary

No production migration, ACL change, function deployment, chapter generation/publication, schedule mutation, or billable Supabase development branch was performed for this check.
