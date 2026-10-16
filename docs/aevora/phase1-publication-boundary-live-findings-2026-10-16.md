# Aevora Phase 1 — publication boundary live catalog findings
Date: 2026-10-16
Environment: live Supabase catalog, read-only SQL inspection
Branch: `aevora/release-scheduler-hardening`
Status: findings only; no database writes performed

## Scope and safety

This pass inspected catalog metadata and stored definitions for selected publication-related tables and routines. It did not query application rows, secrets, prompts, chapter content, or provider response bodies. No DDL, migration, schedule change, generation, or publication was performed.

The live migration ledger's latest entry remains `20261010161919 aevora_release_scheduler_leases`. The hardening migrations listed below are present in the repository but are not represented by later entries in this ledger snapshot.

## Finding 1 — critical publication tables retain ordinary-client table grants

The live catalog reports RLS enabled on the following `public` tables, all owned by `postgres`:

- `release_schedules`
- `series`
- `chapters`
- `chapter_blueprints`
- `chapter_generation_outputs`
- `chapter_reviews`
- `chapter_publication_reviews`
- `story_blueprints`
- `publication_sync_outbox`

For each of these tables, the observed relation ACL includes `anon` and `authenticated` with broad table privileges, including `TRUNCATE`. The observed policy inventory had only the expected public-read policies on `series` and `chapters`; it showed no policies for the internal review/blueprint/outbox tables or `release_schedules`.

RLS does not constrain `TRUNCATE`. For tables with no applicable row policies, RLS does not provide an ordinary row-access path even when grants exist, but the excessive grants still violate the intended least-privilege boundary and must not be treated as safe. Do not rely on RLS as a substitute for revoking internal-table client grants.

The branch contains `20261013130000_lock_internal_policyless_tables.sql` and `20261014180000_revoke_unapproved_internal_client_writes.sql`; these are source candidates for rehearsal/review, not evidence of a live repair.

## Finding 2 — lease RPCs exist live, but their stored definitions differ from hardened source

Live catalog inspection found these functions owned by `postgres`, marked `SECURITY DEFINER`, and executable by `postgres` and `service_role` only in the observed ACL:

- `public.aevora_claim_release_scheduler_lease(uuid, uuid, integer)`
- `public.aevora_renew_release_scheduler_lease(uuid, uuid, integer)`
- `public.aevora_release_scheduler_lease(uuid, uuid)`

Their live stored settings use `search_path = pg_catalog, public, pg_temp`. The prepared source migration `20261012183000_aevora_release_scheduler_lease_foundation.sql` pins the path to `pg_catalog` and schema-qualifies table references. This is a concrete source/live definition drift to resolve before treating the RPCs as fully reconciled.

The live definitions schema-qualify the lease table references. The observed ACL is restricted to trusted server roles, so this finding is not evidence of client execution access. It is a hardening-drift finding, not a claim that the RPCs are currently exploitable.

The stored `public.enqueue_publication_sync_event()` trigger function is also `SECURITY DEFINER` with `search_path = public`; its table references are schema-qualified. The stored `public.taleforge_verify_publication_sync()` uses an empty search path and schema-qualified table references. Review these alongside their trigger bindings and source provenance before changing anything.

## Finding 3 — schema CREATE is not granted to anon/authenticated, but this does not close table-grant gaps

The observed `public` schema ACL grants `USAGE` to `anon` and `authenticated`, but not `CREATE`. That narrows the object-shadowing threat from those roles in this schema. It does not remove their excessive table privileges, nor does it resolve default privileges for object owners.

The observed default-privilege inventory still contains broad client defaults for objects created by `postgres` and `supabase_admin` in `public`. The migration executor's ability to change each owner's defaults must be reviewed separately; do not bypass role membership or guess at an owner-level repair.

## Finding 4 — repository hardening migrations are not recorded in the live migration ledger snapshot

The live ledger's newest recorded version is `20261010161919`. The repository contains later prepared hardening migrations, including:

- `20261013120000_lock_ai_provider_state_table.sql`
- `20261013130000_lock_internal_policyless_tables.sql`
- `20261014170000_restrict_public_default_privileges.sql`
- `20261014180000_revoke_unapproved_internal_client_writes.sql`

Do not infer that the migrations failed or were partially applied solely from this mismatch; the ledger snapshot does show they are not recorded as applied. Do not apply them blindly or fabricate migration history. Reconcile intended migration ordering, source provenance, owner-level defaults, and effective live grants before any authorized production operation.

## Branch validation status

CI run [38873993866](https://github.com/freearmy599/taleforge/actions/runs/38873993866) passed both jobs:
- Prepared Edge Function type-checking and source-contract/security regression tests.
- Disposable PostgreSQL readiness and security rehearsals.

These results validate the tested branch scope only. They do not apply migrations or repair live privileges.

## Next safe actions

1. Keep automated publication blocked by the existing `PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED` preflight.
2. Reconcile and review the prepared internal-table/client-grant migrations against the current live ACL and policy inventory.
3. Add a reviewed drift check for the live lease RPC definitions, preserving the server-only execute ACL.
4. Reconcile default privileges separately for `postgres` and `supabase_admin`; no membership bypass.
5. Obtain authoritative provenance for the original provider-state creation migration before implementing atomic cooldown recording.
6. Re-run disposable PostgreSQL rehearsals and runtime/source checks after any branch changes.
7. Require explicit authorization and a reviewed rollback plan before any production migration or deployment.

## Non-negotiable boundary

No production changes are authorized by this report. Do not deploy, migrate, mutate schedules, generate/publish chapters, or create a billable Supabase branch without explicit authorization.
