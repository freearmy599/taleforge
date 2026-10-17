# Aevora Phase 1 — default-privilege owner-context runbook

Status: planning and read-only diagnosis only. No production ACL changes are authorized by this document.

## Why the current candidate stops

Migration `20261014170000_restrict_public_default_privileges.sql` deliberately refuses to alter defaults for a role that the executing role cannot administer. Live inspection found that the current `postgres` session is not a superuser and is not a member of `supabase_admin`. This is an ownership boundary, not a migration error to bypass.

PostgreSQL default privileges belong to the role that creates future objects. A schema-scoped revoke for one creator cannot cancel a client grant inherited from a global default ACL. The migration therefore fails closed if global table/sequence client defaults exist.

## Required operator workflow

1. Do not run the migration from the current application session. Do not grant the application role membership in `supabase_admin`, elevate it, disable the ownership check, or change global defaults as a workaround.
2. Obtain an approved maintenance window and an authorized database-owner/platform-operator session that can administer defaults for each affected creator role (`postgres` and `supabase_admin`). If no authorized context exists for either role, stop and escalate to the managed database operator; the application cannot safely complete this step itself.
3. In a read-only session, inspect default ACLs for creator roles `postgres` and `supabase_admin`, table/sequence object types, global versus `public` schema scope, and grants to `PUBLIC`, `anon`, or `authenticated`. Record the results before making any change.
4. If any global client grant exists, stop. The current candidate is designed to reject that state. Review the full impact of changing global defaults with the platform/database owner first; do not assume a schema-scoped revoke is sufficient.
5. Have the authorized owner/operator remove client defaults for future tables and sequences in the `public` schema for each creator role, in the matching authorized owner context. The operation must be scoped to the intended creator role and `public` schema. Do not alter global defaults, function EXECUTE defaults, existing-object ACLs, or unrelated managed schemas.
6. Re-run the read-only default-ACL inventory and verify no client table/sequence grants remain in the relevant `public` schema defaults. Verify global defaults remain unchanged. Then run the existing disposable PostgreSQL rehearsal and verify newly created tables/sequences receive no client grants.
7. Only after separate owner-context rehearsal and review should the migration rollout status be reconsidered. Production execution still requires explicit authorization.

## Guardrails

- Never assume a session can become another role. Use only a role context the managed database explicitly authorizes.
- Never alter `supabase_admin` membership, superuser flags, or global defaults to make a migration pass.
- Do not interpret the current ownership failure as permission to weaken the migration.
- The live production database remains unchanged by this runbook.
