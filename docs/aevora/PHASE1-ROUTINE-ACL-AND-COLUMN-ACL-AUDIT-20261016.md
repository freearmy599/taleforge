# Aevora Phase 1 — routine ACL and column ACL follow-up

**Observed:** 2026-10-16  
**Environment:** live Supabase catalog; read-only SQL inspection  
**Branch:** `aevora/release-scheduler-hardening`  
**Status:** evidence only; no database writes or permission changes

## Scope

Inspected schema ACL entries for `public`, `taleforge_internal`, and `extensions`; column ACL metadata for the provider-state relation and ten workflow/publication relations; and catalog metadata for `SECURITY DEFINER` routines in `public` and `taleforge_internal`. This was catalog-only: no application rows, secrets, prompts, or provider response bodies were queried.

## Findings

### 1. No explicit column ACLs on the 11 targeted relations

The catalog reports zero columns with explicit column ACLs on each of the following relations:

- `taleforge_ai_provider_state` (6 columns)
- `chapter_blueprints` (21)
- `chapter_generation_outputs` (20)
- `chapter_publication_reviews` (11)
- `chapter_reviews` (10)
- `chapters` (19)
- `publication_sync_outbox` (12)
- `reader_events` (7)
- `release_schedules` (15)
- `series` (28)
- `story_blueprints` (32)

This does not mean the columns are inaccessible. Effective table-level grants remain broad for `anon` and `authenticated`, as recorded in the preceding live-schema reconciliation. The absence of column-specific ACLs means column grants are not currently providing a narrower access boundary. Do not respond with a blanket revoke: first map each relation to the verified browser and server call paths, preserve public published-series/chapter reads, and preserve the constrained reader-event intake path.

### 2. Inspected SECURITY DEFINER routine ACLs are explicitly server-side

The inspected `SECURITY DEFINER` routines in `public` and `taleforge_internal` expose explicit ACL arrays. In this catalog result, the `public` routines were granted to `postgres` and `service_role`; the internal gate/trigger routines were granted to `postgres`. No explicit `PUBLIC`, `anon`, or `authenticated` execution grant appeared in the returned ACL arrays.

This is a positive catalog signal, not a complete authorization audit. Routine overloads, caller paths, ownership, trigger reachability, and any routines outside the inspected schemas/naming scope still require review. Trigger functions may run through trusted trigger invocation without being directly callable by browser roles; do not change their grants without checking dependencies.

### 3. Search-path configuration needs per-routine body review

The inspected routines show both fixed search paths (for example, `public` or `pg_catalog, public, pg_temp`) and an explicitly empty search path. An empty path can be a deliberate hardening measure, but it requires referenced objects to be safely schema-qualified. Fixed paths also require scrutiny for writable schemas and temporary-schema resolution. The ACL snapshot alone cannot establish that a routine body is injection-safe.

Before changing any function, inspect its complete definition, owner, `proconfig`, effective execute ACL, trigger dependencies, and callers. Preserve the fixed paths already used by the scheduler lease routines unless a separately reviewed change proves otherwise.

### 4. Schema privileges

The catalog showed `public` usage for client roles and `CREATE` associated with `pg_database_owner`; `taleforge_internal` was not exposed with client `USAGE` in the inspected schema ACL result. The `extensions` schema has `USAGE` grants for `anon` and `authenticated`, as well as owner/admin privileges. Schema privileges must be evaluated alongside relation/routine grants; they do not negate the broad table grants already observed.

## Gate and next steps

- **Production remains NO-GO** for automatic publication and unreviewed permission migrations.
- Build the least-privilege matrix relation by relation, linked to verified browser assets, Edge Functions, triggers, RPCs, and operational callers.
- Review all relevant `SECURITY DEFINER` bodies and trigger dependencies, especially routines with an empty search path; do not infer a vulnerability solely from that setting.
- Reconcile the missing provider-state creation migration and owner-specific default ACLs before implementing atomic cooldown persistence.
- Continue to keep automatic publishing stopped in the prepared branch until authorization and transaction boundaries are implemented and rehearsed.

No production permissions, routines, migrations, schedules, chapter generation, or publication were changed.
