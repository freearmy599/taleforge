# Aevora Phase 1 — live provider-state reconciliation addendum
Date: 2026-10-16
Repository: `freearmy599/taleforge`
Branch: `aevora/release-scheduler-hardening`

## Latest branch validation

CI run [38936093165](https://github.com/freearmy599/taleforge/actions/runs/38936093165) completed successfully. Both jobs passed:
- Edge Function type-checking and source-contract regression suite.
- Disposable PostgreSQL readiness/security rehearsal, including provider-state client ACL revocation, idempotent throttle concurrency, public default-privilege revocation, and policyless internal-table grants.

This is branch-only evidence. It does not verify live Edge Runtime behavior, deploy branch code, or authorize production changes.

## Fresh read-only live findings

A new read-only catalog query on the connected production project confirmed:
- `public.taleforge_ai_provider_state` still grants `anon` and `authenticated` relation-level DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, and UPDATE.
- Both client roles also retain column-level INSERT, REFERENCES, SELECT, and UPDATE grants across the six provider-state columns. These column grants are independent of relation-level grants and must be explicitly revoked.
- The table's existing grants are not repaired by the branch-only migration because that migration has not been applied live.
- `pg_default_acl` still contains broad defaults for future public tables, sequences, and functions under both `postgres` and `supabase_admin`, including client-role grants. The defaults for `supabase_admin` also exist in other schemas; any remediation must distinguish public application objects from managed/system schemas and respect owner-role boundaries.
- Live migration history still records `20261007025751 / add_taleforge_ai_provider_cooldown_state`, but attempts to recover its source from the current repository branch and default branch returned no file. Its authoritative body remains unrecovered; do not reconstruct the historical migration from the current schema.

## Required remediation gates

1. Reconcile the authoritative provider-state creation migration from an approved source of migration history.
2. Finish the provider-state reader/writer call graph and least-privilege grant matrix before revoking production privileges.
3. Review the branch-only table ACL and default-privilege migrations for Supabase owner-role compatibility and effects on managed schemas.
4. Rehearse on disposable PostgreSQL, validate Supabase Edge Runtime behavior, then reconcile deployed versions.
5. Obtain explicit authorization before any live migration, grant change, or Edge Function deployment.

No production SQL mutation, migration, function deployment, schedule mutation, chapter generation, publication, or billable Supabase branch was performed during this audit. Automatic publishing remains **NO-GO**.
