# Aevora Phase 1 — client maintenance ACL hardening candidate
Date: 2026-10-16
Branch: aevora/release-scheduler-hardening

## Why this candidate exists

The live read-only inventory found 103 public tables with relation-level TRUNCATE granted to anon and/or authenticated, and 103 with client relation-level INSERT/UPDATE/DELETE grants. This is not a recommendation to remove all CRUD grants: many tables support intended user-facing actions. TRUNCATE, TRIGGER, and REFERENCES are database-maintenance privileges that browser/API roles should not need.

## Branch-only implementation

Added `supabase/migrations/20261016200000_revoke_client_table_maintenance_privileges.sql`. It loops over ordinary and partitioned tables in `public` and revokes:
- relation-level TRUNCATE, TRIGGER, and REFERENCES from PUBLIC, anon, and authenticated;
- column-level REFERENCES from the same principals.

It intentionally does not revoke SELECT, INSERT, UPDATE, or DELETE. It does not revoke trusted `service_role` or owner privileges, create client policies, or modify any live database.

## Regression coverage added

- The internal policyless-lock disposable fixture now includes a user-facing `chapters` table with broad fixture grants, to verify maintenance-only revocation preserves CRUD.
- The internal lock rehearsal applies the new candidate after the targeted internal-table lock migration.
- Assertions verify maintenance privileges disappear for client roles, CRUD stays available on the fixture `chapters` relation, column REFERENCES is removed, and explicit trusted `service_role` maintenance privileges remain.
- The release-readiness contract test now checks the migration's table scope and ensures it does not revoke ordinary CRUD.

## Validation status and limitations

The existing CI run 38936093165 predates this candidate. The new branch commits need their own CI run; do not mark the candidate validated until the Edge/source-contract job and disposable PostgreSQL rehearsal pass.

This migration addresses a narrow privilege class. It does not replace the table-by-table access classification required for client CRUD, the server-only table ACL repairs, owner-aware default-privilege reconciliation, migration provenance, or deployed Edge Function parity. Production remains NO-GO for automated publication and for unreviewed migrations.
