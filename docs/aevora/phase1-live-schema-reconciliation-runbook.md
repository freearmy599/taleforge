# Aevora Phase 1 — live schema reconciliation runbook

Purpose: collect the minimum catalog evidence needed to safely design the provider-cooldown and publication-boundary repairs. This is an evidence-collection guide, not a migration.

## Safety rules

- Use an already-authorized read-only SQL session against the intended project.
- Do not share API keys, database passwords, connection strings, access tokens, or service-role secrets.
- Do not export application rows, chapter text, user data, provider payloads, or secrets.
- Do not execute these inventories as migrations. They contain catalog SELECTs only.
- Do not create a Supabase development branch or incur paid usage.
- Do not apply schema changes, deploy functions, mutate schedules, generate chapters, or publish chapters during this evidence step.
- If a query errors or the results are ambiguous, preserve the error text with credentials/hostnames removed and stop; do not infer missing schema.

## Inventory scripts

Run each script only through the authorized read-only session:

1. `docs/aevora/phase1-provider-state-schema-provenance.sql`
2. `docs/aevora/phase1-publication-schema-provenance.sql`

Save the catalog-only outputs in the project's approved private audit record. Do not commit live database output if it reveals internal role names or security posture beyond what the repository's review process permits.

## Provider-state evidence to reconcile

### Migration chronology currently known

The live ledger's latest observed entry is `20261010161919 aevora_release_scheduler_leases`. The repository's provider-state lock migration (`20261013120000_lock_ai_provider_state_table.sql`) and default-privilege hardening migration (`20261014170000_restrict_public_default_privileges.sql`) are later than that ledger entry, so their absence from the live ACL state is consistent with those hardening migrations not yet being applied. This is not a deployment authorization.

Separately, the ledger contains `20261007025751 add_taleforge_ai_provider_cooldown_state`, but the current branch and `main` do not contain a matching creation migration. Do not invent or backfill a historical migration file. Establish its origin from an approved source of truth before writing a new atomic RPC migration or reconciling migration history.

For `public.taleforge_ai_provider_state`, confirm:

- Relation exists, exact owner, RLS flags, and relation kind.
- Exact column names/types/nullability/defaults for provider, cooldown, counter, error fields, and timestamps.
- Primary key, unique constraints/indexes, check constraints, and any partial indexes.
- Triggers and trigger-function definitions/owners/security settings.
- Effective relation and column grants, schema CREATE/USAGE rights, and default privileges.
- Existing related routines, signatures, owners, security-definer status, and fixed search paths.
- Matching repository migration history and deployed definitions.

Do not design the atomic RPC until the uniqueness invariant and actual types are known. If the table is absent, duplicated, or differs from migrations, stop and reconcile the drift first.

## Publication evidence to reconcile

For each relation listed by the publication inventory, confirm:

- Relation identity, ownership, RLS and forced-RLS state.
- Exact columns, types, defaults, and constraints.
- Unique indexes and duplicate-prevention invariants.
- Triggers and trigger-function security.
- Schema/table/column ACLs and default privileges.
- Routine signatures, owners, execute grants, and security-definer search paths.
- Whether the release schedule, series status, chapter row, qualified review evidence, and outbox event can be committed atomically under the current schema.

The inventory output alone does not prove a safe publication transaction. Compare it with repository migrations and actual deployed routine definitions.

## Evidence summary template

Record only sanitized catalog facts and a source reference; no credentials or application row data.

| Item | Evidence/source | Result |
|---|---|---|
| Provider-state relation and exact columns | Provider inventory + migration history | Partially verified; original creation migration missing from current Git history |
| Provider unique key / counter invariant | Provider inventory + migration history | Pending |
| Provider-state grants and routine owners | Provider inventory | Grants observed; later lock migration not recorded as applied in live ledger |
| Publication relation/column inventory | Publication inventory + migration history | Pending |
| Publication unique constraints and triggers | Publication inventory + migration history | Pending |
| Publication routine ACLs and search paths | Publication inventory | Pending |
| Live schema vs migration drift reconciled | Approved audit record | Pending; original creation migration provenance unresolved |

## Exit criteria

Only after all relevant evidence is reconciled should the branch add a migration for an atomic cooldown operation or publication transaction. The implementation then needs disposable PostgreSQL concurrency/rollback tests, ACL regression tests, Edge Function type-checking, the complete Phase 1 suite, and actual Supabase Edge Runtime validation.

Automated publishing must remain blocked until the publication transaction and its authorization are verified. This runbook does not authorize production changes, billable work, generation, or publication.
