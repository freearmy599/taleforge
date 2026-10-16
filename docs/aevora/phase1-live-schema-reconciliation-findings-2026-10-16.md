# Aevora Phase 1 — live schema reconciliation findings

**Observed:** 2026-10-16  
**Environment:** live Supabase catalog, read-only SQL inspection  
**Status:** findings only; no database writes performed  
**Branch:** `aevora/release-scheduler-hardening`

This record contains catalog metadata only. No application rows, secrets, prompts, or provider response bodies were queried.

## Confirmed findings

### 1. Provider-state relation exists, but client grants contradict the intended lock-down

The live relation `public.taleforge_ai_provider_state` exists, is owned by `postgres`, and has row-level security enabled. Its `provider` key is the primary key. The throttle counter is an integer and the cooldown timestamp is nullable `timestamp with time zone`. No user-defined triggers were found on this relation.

The effective table ACL inventory showed ordinary-client privileges for both `anon` and `authenticated`, including `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`. RLS does not substitute for revoking table-level privileges such as `TRUNCATE`.

The repository contains `20261013120000_lock_ai_provider_state_table.sql`, whose intended operation explicitly revokes table and column privileges from `PUBLIC`, `anon`, and `authenticated`. The live privilege result therefore does not match the expected post-migration state.

**Do not apply the lock migration blindly.** First reconcile migration history and verify why the live ACLs differ, then prepare an explicit, reviewable repair and re-check effective privileges.

### 2. Migration history and repository migration files are out of sync

The live migration ledger includes version `20261007025751` named `add_taleforge_ai_provider_cooldown_state`. The current hardening branch does not contain a file at the corresponding expected path/name, and its migration directory does not contain a provider-state creation migration. The branch does contain later lock-down SQL.

A follow-up repository-history check found no Git commit history for the exact expected migration path. The current `main` tree also has no migration filename matching provider/cooldown/throttle. This narrows the discrepancy but does not establish whether the migration was renamed, originated in an untracked/private source, or was created through another workflow. Search results are not a substitute for the original migration body.

This is migration-history drift, not proof that the relation was created manually. Its origin must be established from the available database/repository records before adding a new migration or editing history. Do not fabricate a historical migration or mark migrations applied to make the lists appear aligned.

### 3. Default privileges remain a separate security gate

The live default-ACL inventory shows broad defaults affecting future objects in `public` (tables, sequences, and function execution). The branch migration `20261014170000_restrict_public_default_privileges.sql` deliberately skips owner roles when the migration executor is not a member of those roles; it notes that the `postgres` owner needs a separately authorized privileged operation.

Therefore, even a successful table-specific revoke would not by itself resolve future-object defaults. Inspect each relevant owner role and effective defaults, then design a narrowly scoped and authorized correction. Do not broaden privileges or change global defaults speculatively.

### 4. Atomic provider cooldown repair is still not implemented

The provider-state inventory did not find a matching existing cooldown/throttle recording routine. The current design gate in `docs/aevora/phase1-provider-cooldown-atomicity-plan.md` remains valid: use one database-atomic operation, serialize concurrent counter increments and first insert, never shorten an existing cooldown, fail closed on invalid persisted state, and restrict execution to the intended server-side role.

The concurrency review also identifies a fallback read-modify-upsert in `generation-orchestrator`, in addition to the direct worker cooldown path. Both call paths must be included in the atomicity audit so one provider failure is not recorded twice and concurrent increments are not lost.

Do not draft a guessed function signature or deploy a migration until relation provenance and migration history are reconciled.

## Next safe actions

1. Reconcile the live migration ledger against all repository migrations and any available historical source for the missing provider-state creation migration.
2. Capture effective ACL evidence for the provider table, its columns, the `public` schema, relevant default-privilege owner roles, and any related routines.
3. Prepare—but do not apply—a targeted provider-state permission repair with a disposable PostgreSQL rehearsal and effective-privilege tests.
4. Implement and test the atomic cooldown operation only after the schema/history discrepancy is resolved, covering both worker and orchestrator fallback paths.
5. Re-run Edge Function type-checking, Phase 1 source contracts, disposable PostgreSQL tests, and real Supabase Edge Runtime validation.

## Safety boundary

This document does not authorize production migration, deployment, publication, generation, schedule mutation, or creation of a billable Supabase branch. No such actions were performed during this inspection.
