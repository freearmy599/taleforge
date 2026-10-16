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

## Consequences for the candidate migration

The branch migration 20261014170000_restrict_public_default_privileges.sql currently:
1. revokes globally for each owner role, which changes future-object defaults beyond the public schema;
2. also revokes in the public schema;
3. silently emits a NOTICE and skips an owner role if the migration executor lacks authority.

The global revokes do not cancel the explicit schema-specific grants in storage/graphql/graphql_public/realtime. Therefore the current migration is not a complete managed-schema cleanup, while its global function revoke may change built-in/default behavior for future functions outside public. The contract test that only asserts there are no explicit managed-schema statements is not enough to establish safe scope.

## Next safe implementation

- Keep the migration branch-only.
- Treat postgres/public as a separately reviewed app-schema correction; inventory postgres/storage before changing any defaults there.
- Treat each supabase_admin schema as owner-managed and separately reviewed. Do not mutate its defaults from an application migration unless the owner-level authority, expected grants, and regression checks are explicit.
- Replace the "skip with NOTICE" behavior with a release gate that fails validation when a required owner/schema correction was not performed. Do not make production migration success imply that every owner was corrected.
- Add disposable tests that seed global and schema-specific ACLs separately and verify the resulting effective privileges for each relevant role, including PUBLIC, anon, authenticated, service_role, and dashboard_user.

This document records catalog evidence only. No production grants, defaults, migrations, functions, schedules, chapters, or publications were changed.
