# Aevora Phase 1 — Provider-State Migration and Atomic Cooldown Gate (2026-10-16)

Status: **blocked on authoritative schema/deployment provenance; design and source review only**.

Branch: `aevora/release-scheduler-hardening`

## Current CI evidence

The following runs completed successfully on the hardening branch:

- [38903977080](https://github.com/freearmy599/taleforge/actions/runs/38903977080) — Edge source validation and disposable PostgreSQL rehearsal passed.
- [38904025908](https://github.com/freearmy599/taleforge/actions/runs/38904025908) — Edge source validation and disposable PostgreSQL rehearsal passed.
- [38904122156](https://github.com/freearmy599/taleforge/actions/runs/38904122156) — Edge source validation and disposable PostgreSQL rehearsal passed.

These results validate the named branch/test scopes only. They are not proof of production migration status, live grants, or Edge Runtime behavior.

## Reconciled evidence available so far

Prior read-only catalog results for `public.taleforge_ai_provider_state` recorded:

- Owner: `postgres`; RLS enabled but not forced.
- Six columns: `provider text NOT NULL` primary key; `cooldown_until timestamptz`; `consecutive_throttle_count integer NOT NULL DEFAULT 0`; `last_error text`; `last_error_at timestamptz`; `updated_at timestamptz NOT NULL DEFAULT now()`.
- Broad relation-level privileges granted to `anon` and `authenticated`, including write privileges and `TRUNCATE`/`MAINTAIN` where supported by the server version.
- Broad future-object default privileges for `public` owned by both `postgres` and `supabase_admin`; the branch migration's conditional owner handling does not itself prove the `supabase_admin` defaults have been corrected.
- The live migration ledger query showed `20261007025751 add_taleforge_ai_provider_cooldown_state`, while the original creation migration body was not found in the visible branch history. This is a provenance gap, not proof of the original migration's exact contents or how it was deployed.
- A catalog search by routine-name patterns found no provider-state/cooldown-named routines in the schemas queried. That is not an exhaustive proof that no differently named routine reads or writes this table.

The evidence above is historical read-only audit output. It should be re-collected through the authorized read-only SQL session before any migration is approved.

## Review of the branch provider-state lock migration

File: `supabase/migrations/20261013120000_lock_ai_provider_state_table.sql`.

The migration enables RLS, rewrites `last_error` for the existing Gemini row to a small set of generic diagnostics, updates `updated_at`, and revokes relation-level and column-level privileges from `PUBLIC`, `anon`, and `authenticated`.

Risk disposition:

1. **Do not apply yet.** The diagnostic rewrite is a data mutation. It irreversibly replaces existing diagnostic text unless an independently approved, protected evidence-retention process exists. Do not export or copy raw provider response bodies into ordinary logs or repository documentation.
2. The grant revocation is directionally appropriate for a server-only state table, but trusted server callers and any indirect access through views, routines, triggers, or service-role code must be mapped before rollout.
3. RLS alone is not the security boundary for `TRUNCATE`; explicit relation privileges matter. Verify effective relation and column ACLs after any eventual change.
4. Correcting future default privileges is a separate owner-specific task. The `supabase_admin` owner context must not be bypassed through role escalation or an unreviewed membership change.
5. This migration does not provide atomic cooldown recording and must not be treated as resolving concurrent counter updates.

## Atomicity defect and required unified repair

Both `generate-chapter` and `generation-orchestrator` currently have read/compute/upsert cooldown paths. Those paths can race and lose increments. The orchestrator's active-cooldown check is not an idempotency guarantee.

A future database operation must be shared by both writers and satisfy all of these conditions:

- Atomically handles both first-row creation and updates under concurrent calls.
- Serializes counter increments without lost updates.
- Never shortens the longest active cooldown, including when a temporary-overload event races a quota event.
- Uses database time consistently and returns a typed, explicit persisted outcome.
- Does not silently convert malformed persisted counters into zero.
- Treats database failure as failure; callers must not report successful cooldown recording or continue on an assumed-safe state.
- Is executable only by the intended trusted server role, with verified effective ACLs and a safe, fixed `SECURITY DEFINER` search path if that security model is used.
- Does not persist or return prompts, user content, secrets, or raw provider response bodies.
- Defines retry semantics explicitly. Do not claim idempotency unless a stable event key and corresponding database enforcement are designed and tested.

## Tests required before release

1. Concurrent increments from a known initial count produce the exact expected final count.
2. Concurrent quota and overload recordings never shorten an active cooldown.
3. Two concurrent first inserts create one provider row and account for both accepted events.
4. Invalid persisted state returns an explicit failure and is not silently normalized.
5. Database/RPC errors cause both callers to fail closed.
6. Both Edge Functions use the same atomic operation; no read-modify-upsert cooldown writer remains.
7. Effective privileges deny `PUBLIC`, `anon`, and `authenticated`, while the intended server role can execute it.
8. A real PostgreSQL concurrency rehearsal exercises the migration and operation; static source checks alone are insufficient.
9. Type-checking, source-contract tests, disposable database rehearsal, and separate Supabase Edge Runtime compatibility checks all pass.

## Evidence needed to unblock design

1. Obtain the authoritative migration-ledger export and original creation migration or verified deployment artifact for the provider-state table.
2. Re-run the read-only provenance inventory in `docs/aevora/phase1-provider-state-schema-provenance.sql`, including relation/column ACLs, defaults, constraints, indexes, triggers, routine definitions/settings, and relevant caller references.
3. Reconcile all existing readers and writers, including production-only functions not present in the branch.
4. Decide whether stable event identity is available for deduplicating one upstream failure observed by both the worker and orchestrator. If not, explicitly define how duplicate observations affect counters.
5. Only then write the atomic RPC migration and concurrency tests. Do not guess a signature or deploy a speculative migration against an unreconciled schema.

## Change boundary

This gate is a code-review record only. It does not authorize production DDL, migration application, grants/policies, deployment, schedule changes, chapter generation, or publication. No live changes were performed during this review.


## Fresh read-only Supabase reconciliation (2026-10-16)

A new read-only Supabase MCP migration inventory and catalog query were completed for project `sxmbnlgufqhcwxcpcsvb`; no DDL or application RPC was executed.

- The migration inventory returned 232 records. The latest recorded version is `20261010161919 aevora_release_scheduler_leases`; there are no versions at or after `20261011000000` in that returned inventory.
- The live ledger includes `20261007025751 add_taleforge_ai_provider_cooldown_state`, but does not include `20261013120000_lock_ai_provider_state_table` or the later branch-only lock/default-privilege/reader-intake migrations.
- A fresh catalog query reconfirmed the exact six-column provider-state schema and owner `postgres`; RLS is enabled and not forced.
- A separate ACL query reconfirmed broad relation-level privileges for both `anon` and `authenticated`, including `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` (server-version-dependent).

This strengthens the live-versus-branch drift finding. It still does not provide the missing original creation-migration body, identify every differently named routine that may access the table, or map every deployed writer. The provider lock migration remains unapplied and on hold. No provider-state row values were read, and no production state was changed.
