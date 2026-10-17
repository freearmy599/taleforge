# Aevora governance gate dependency and ACL follow-up — 2026-10-17

Scope: read-only catalog inspection of the connected live Supabase project and tracked branch source. No data rows were read or modified, and no grants, policies, functions, migrations, deployments, schedules, chapters, or publications were changed.

## Findings

### 1. Gate dependency is now identified

The live `public.taleforge_ceo_execution_gate(p_action_scope text)` calls `public.taleforge_boss_evaluate(p_action_scope)`. Both are owned by `postgres`, are `SECURITY DEFINER`, use `search_path=public`, and have effective EXECUTE for `service_role` but not `anon` or `authenticated`. The gate also checks `auth.role() = 'service_role'`.

The boss evaluator reads governance registry/dependency/health state and inserts a governance-run record. It can return `proceed_with_restrictions` for some degraded/unknown conditions; the CEO gate treats that decision as `authorized: true`. Therefore, this is a platform health/governance decision, not a per-chapter human approval token. It cannot close the missing trusted-approver requirement for publication.

### 2. Governance tables have overbroad explicit table ACLs

The live catalog reports RLS enabled but not forced for these tables, with explicit relation grants to `anon`, `authenticated`, and `service_role`:

- `public.taleforge_system_governance_registry`
- `public.taleforge_system_governance_dependencies`
- `public.taleforge_system_governance_runs`
- `public.taleforge_system_health`

Effective table privilege checks show client roles have mutation privileges at the ACL layer. Policy inspection returned a client SELECT policy only for `taleforge_system_health`; no policies were returned for the other three tables, and no client write policies were returned for any of these four. Thus the ACLs are overbroad and should be reconciled, but this query alone does **not** prove that client writes succeed through PostgREST: RLS policy enforcement is a separate gate. No write test was attempted.

This needs to be included in the broader relation-by-relation ACL reconciliation. Do not apply isolated revokes until all browser, Edge, trigger, SQL routine and operational callers are mapped and a rollback/rehearsal plan is approved.

### 3. Source provenance remains unresolved

Connected GitHub source search returned no tracked matches for `taleforge_ceo_execution_gate` or `taleforge_boss_evaluate`. The inspected governance migrations create the earlier system registry/health structures but do not define these exact routines or the `taleforge_system_governance_*` objects. Live definitions are known from catalog inspection, but the authoritative migration/source artifact is not yet recovered. Search results are not a complete historical repository archive, so this is a provenance gap—not proof the source never existed.

## Required follow-up

1. Recover the authoritative migration or platform-created SQL artifact for both governance routines and their tables.
2. Add the four governance relations to the ACL reconciliation matrix with explicit intended role-by-role privileges.
3. Keep the governance gate classified as health/policy evaluation only, not human publication approval.
4. Keep automated publishing **NO-GO** until a trusted approver identity/source and a transaction-bound approval record are defined, tested and authorized.
5. Rehearse ACL changes in a disposable database before any live rollout; current `supabase_admin` default-ACL owner limitation remains a separate blocker.

Metadata-only audit. No production changes were made.


## Follow-up: exact default-ACL grants by creator role

A second read-only catalog query grouped default privileges by the creating role, avoiding the earlier report's omission of that dimension. In schema `public`, both `postgres` and `supabase_admin` have default ACL entries granting the following to both `anon` and `authenticated`:

- Tables: `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` and the PostgreSQL-version-specific `MAINTAIN` privilege.
- Sequences: `SELECT, UPDATE, USAGE`.
- Functions: `EXECUTE`.

None of these expanded default ACL grants is grantable onward. The entries are present separately for both creator roles. This provides direct live evidence that newly created public-schema objects can inherit broad client privileges unless object-specific ACL changes or corrected defaults intervene. It does not identify who originally established the entries or prove which existing relation ACLs came from them.

The executor still lacks the required `supabase_admin` owner path, so no default privileges were altered. The remediation must be rehearsed for each creator role and object type, with before/after effective ACL checks; production changes remain blocked pending authorized owner/operator execution and caller review.
