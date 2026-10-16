# Aevora Phase 1 — default ACL catalog evidence
Date: 2026-10-16
Environment: read-only catalog inspection of connected Supabase project
Branch: aevora/release-scheduler-hardening

## Exact default ACL rows observed

The catalog query found schema-specific default ACL entries for these owner/schema pairs:

| Owner | Schema | Default object types with explicit ACL rows |
|---|---|---|
| postgres | public | tables, sequences, functions |
| postgres | storage | tables, sequences, functions |
| supabase_admin | public | tables, sequences, functions |
| supabase_admin | graphql | tables, sequences, functions |
| supabase_admin | graphql_public | tables, sequences, functions |
| supabase_admin | cron | tables, sequences, functions |
| supabase_admin | extensions | tables, sequences, functions |
| supabase_admin | realtime | tables, sequences, functions |

The returned catalog had no global rows (defaclnamespace IS NULL) for these owners at the time of this query. PostgreSQL's built-in defaults still apply where no explicit global ACL row exists, and schema-specific grants are additive with global defaults.

Selected concrete examples:
- postgres / public: default tables, sequences, and functions explicitly grant broad privileges to anon, authenticated, and service_role.
- postgres / storage: the same broad client-role defaults are present.
- supabase_admin / public, graphql, and graphql_public: broad defaults for all three object types include anon, authenticated, and service_role.
- supabase_admin / cron and extensions: the explicit defaults shown grant these object privileges to postgres, not to the client roles.
- supabase_admin / realtime: the defaults include grants for postgres and dashboard_user; this is a separate managed-schema policy and should not be casually overwritten.

## Consequences and current branch-candidate state

The earlier version of `20261014170000_restrict_public_default_privileges.sql` used global revokes for tables, sequences, and functions and skipped unauthorized owners with a NOTICE. That version was unsafe to ship.

The branch candidate has now been revised (commit `966217100374c45e6b30f875917e39340ea4938e`) to:
1. change only schema-specific defaults for future tables and sequences in `public`;
2. fail closed if a required owner/client role is missing, the executor cannot administer an owner role, or an additive global table/sequence client default is detected;
3. leave existing objects unchanged;
4. deliberately defer function EXECUTE defaults. PostgreSQL's built-in PUBLIC EXECUTE default is global, so a schema-only REVOKE is insufficient; a safe function-default change needs separate owner/schema impact analysis and function-level allowlists.

This revision is a branch candidate, not a live repair. It still needs its disposable PostgreSQL rehearsal and CI confirmation.

## Remaining default-ACL work

- Keep the migration branch-only until its rehearsal passes.
- Treat each `supabase_admin` schema as owner-managed and separately reviewed. This candidate only touches `public`.
- Resolve future function EXECUTE defaults separately. Do not claim this migration closes that exposure.
- Continue to verify effective privileges for `PUBLIC`, `anon`, `authenticated`, `service_role`, and `dashboard_user` where applicable.
- Existing-object ACLs and the 39 policyless relations with client grants require separate remediation; this migration does not repair them.

This document records read-only catalog evidence and branch-only candidate work. No production grants, defaults, migrations, functions, schedules, chapters, or publications were changed.
