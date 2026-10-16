# Aevora Phase 1 — maintenance ACL candidate validation
Date: 2026-10-16

The branch-only candidate for client maintenance privileges is validated by [CI run 38938475415](https://github.com/freearmy599/taleforge/actions/runs/38938475415), which completed successfully on commit 3284dfe66ba4ebf8877da9eb43c36212fed401f6.

Both jobs passed:
- Edge Function type-checking and source-contract tests.
- Disposable PostgreSQL readiness/security rehearsal, including the internal-table lock rehearsal and public default-privilege rehearsal.

The candidate migrations are:
- 20261016200000_revoke_client_table_maintenance_privileges.sql
- 20261016203000_revoke_client_maintenance_default_privileges.sql

The disposable fixture verifies that client maintenance permissions are removed while intended CRUD remains on the non-internal fixture table and future tables owned by postgres and supabase_admin. It also verifies that a global maintenance default blocks the schema-scoped repair.

This is branch-only validation. The connected production database was not modified. Live table ACL repair, owner-level default privilege approval, original migration provenance, deployed function parity, and Supabase Edge Runtime validation remain open. Automatic publication remains NO-GO.
