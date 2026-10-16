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


## Caller reconciliation — source-level findings (2026-10-16 continuation)

This is a source-level review of the current hardening branch only. It does not claim that these exact files match deployed production functions.

### Confirmed direct readers/writers

1. `supabase/functions/generate-chapter/index.ts`
   - Generation path reads `cooldown_until` and `consecutive_throttle_count` before invoking Gemini (currently around lines 52–61 in the reviewed blob).
   - Quality-review path independently reads the same state immediately before its Gemini review call (around lines 233–244).
   - Catch handling for Gemini HTTP 429/503 reads the row, computes a new count and cooldown in application code, then upserts the row (around lines 282–307). This is a read/compute/write sequence and is not atomic across concurrent workers.

2. `supabase/functions/generation-orchestrator/index.ts`
   - Entry and per-schedule paths read the same cooldown state (around lines 32–40 and the schedule loop).
   - `recordGeminiThrottle` reads the current row, computes the next count/deadline in application code, and upserts it (around lines 44–75).
   - The function intentionally returns without incrementing if it sees an already-active cooldown, to avoid double-counting a downstream worker's response. This heuristic is not an idempotency guarantee: concurrent reads/writes can race, and a shared event identifier is not currently enforced by the table.

### Design implications

- A single database-side operation must replace both write paths; merely locking down table grants would otherwise break trusted workers that currently write directly.
- The two preflight checks should remain fail-closed, but eventually should call a narrow trusted read function or use an explicitly authorized server role after ACL design is verified.
- Duplicate observations cannot be made exactly-once by checking whether a cooldown is active. Before promising idempotency, decide whether the same provider failure can carry a stable event key through both the worker response and orchestrator fallback. If not, specify a deliberate counting policy and test it.
- The current branch lock migration revokes client-role access but does not create the atomic writer, does not migrate callers to an RPC, and does not resolve owner-specific future default privileges.

### Provenance limitations

The authoritative original creation migration body is still absent from the checked branch path; attempting to fetch `supabase/migrations/20261007025751_add_taleforge_ai_provider_cooldown_state.sql` returned not found. The branch lock migration body is available, but it is not a substitute for the original creation artifact. No broad repository search or migration-ledger name match should be treated as proof of all deployed callers. The live migration inventory and catalog must be re-collected read-only before a rollout proposal.

### Next safe engineering gate

1. Inventory repository references to `taleforge_ai_provider_state` and deployed Edge Function versions using authorized metadata-only methods.
2. Retrieve the original creation migration/deployment artifact from the authoritative source.
3. Design the atomic RPC signature and role grants against that verified schema.
4. Add concurrent PostgreSQL tests for first insert, exact counter increments, longest-deadline preservation, invalid state, and permission denial.
5. Keep production NO-GO until deployed caller parity and effective grants/default privileges are independently verified.

No migration, deployment, production data change, or AI work was performed as part of this source review.


## Atomic operation contract and test matrix (2026-10-16 continuation)

This section specifies the implementation contract only. It is deliberately not a migration or deployment instruction: the original table-creation artifact and production caller parity are still unverified.

### Proposed database operation contract

Use one narrowly granted database function for provider-failure recording. It must execute the counter update and cooldown extension in one transaction and serialize competing writes for the same provider key. The final SQL must be written only after the original table definition, column types, constraints, ownership, and supported PostgreSQL version are recovered.

Inputs should be constrained to a small enumerated failure class (quota/rate-limit versus temporary overload) and, if a real shared event key can be propagated by both caller paths, a bounded idempotency key. Do not accept raw provider response bodies or arbitrary cooldown intervals from callers. Compute the duration inside the trusted database function using the agreed backoff policy.

Required semantics:

1. **Atomic creation/update:** simultaneous first observations produce one provider row and no lost increments.
2. **Counter safety:** increment only for a new accepted failure event; reject overflow and malformed persisted values without silently resetting state.
3. **Deadline monotonicity:** set the deadline to the later of the current valid deadline and the newly calculated deadline. A later-arriving weaker failure must not shorten an active cooldown.
4. **Failure policy:** callers treat a failed write or uncertain read as blocked and must not make another Gemini call in the same operation.
5. **Diagnostic minimization:** persist only a safe fixed message, never raw response text, keys, prompts, or provider payloads.
6. **Privilege boundary:** revoke direct table access from PUBLIC/anon/authenticated; grant function execution only to the actual server role used by trusted Edge Functions. Verify function ownership, SECURITY DEFINER search path if used, and default privileges for the owner. Do not assume service-role function execution semantics without checking the live deployment.
7. **Read path:** preflight readers must use a verified server-only access path. Keep the generation and quality-review preflight checks fail-closed until both are migrated and tested.

### Duplicate-observation policy is an explicit design decision

The current orchestrator avoids a second increment when it sees an active cooldown, but concurrent requests can both observe an inactive state. Exactly-once handling requires a stable failure/event identifier that survives the downstream response and fallback recording. If that identifier cannot be reliably propagated, implement and document an at-least-once counting policy rather than claiming idempotency; test that policy's effect on backoff and cooldown duration.

### Required disposable-PostgreSQL tests

- 20+ concurrent first writes for the same provider: one row, deterministic counter behavior, no lost updates.
- 20+ concurrent updates after initialization: accepted unique events produce the expected final count.
- Same idempotency key submitted concurrently: one increment if idempotency is supported.
- Shorter proposed deadline against a longer existing deadline: deadline remains unchanged.
- Longer proposed deadline against a shorter existing deadline: deadline extends.
- Quota and temporary-overload events racing: documented deterministic counter/deadline semantics.
- Missing row, malformed timestamp, negative/non-integer count, and integer overflow: operation fails safely and callers remain blocked.
- Function error/transaction rollback: no partial counter/deadline mutation.
- anon and authenticated cannot select, insert, update, delete, truncate, or execute the privileged writer; intended server role can call only the approved function.
- Newly created functions under each relevant owner do not inherit unsafe default PUBLIC execution privileges.

### Current source facts and blockers

The current branch has direct provider-state reads in generate-chapter at lines 52 and 233 and a direct upsert at line 304; generation-orchestrator reads at lines 32 and 48 and upserts at line 71. These are source line references for the reviewed blobs, not proof of production parity. The branch lock migration only revokes client privileges and redacts existing diagnostic strings; it does not implement this atomic operation or migrate those callers. The original creation migration file still returns 404 in the checked branch.

**Gate decision:** do not add or apply a guessed migration yet. Next retrieve the original migration/deployment artifact and read-only live function metadata, then implement the function and caller changes in the disposable test environment first. No production migration, deployment, or data mutation was performed.


## Live production metadata reconciliation (2026-10-16 continuation)

Read-only inspection of the connected production project (project ref `sxmbnlgufqhcwxcpcsvb`) produced a material security finding. The live migration ledger contains `20261007025751 add_taleforge_ai_provider_cooldown_state`, but does **not** contain the branch lock migration `20261013120000_lock_ai_provider_state_table` or a later provider-state permissions repair.

The live table schema is `provider text NOT NULL`, `cooldown_until timestamptz`, `consecutive_throttle_count integer NOT NULL DEFAULT 0`, `last_error text`, `last_error_at timestamptz`, and `updated_at timestamptz NOT NULL DEFAULT now()`. Catalog metadata reports owner `postgres`, RLS enabled, `FORCE ROW LEVEL SECURITY` disabled, and relation ACL `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`. This explicitly shows broad table privileges still granted to `anon`, `authenticated`, and `service_role`, including write/maintenance privileges. Treat this as a confirmed production security blocker; RLS does not cancel table-level grants.

Read-only Edge Function metadata and deployed source inspection also confirm production drift from the checked branch: live `generate-chapter` is version 59 (branch source reviewed was version 58) and live `generation-orchestrator` is version 35. Both still perform direct reads and read/compute/upsert writes against this table. The deployed generator writes a truncated raw error message (`message.slice(0,2000)`) into `last_error`; the orchestrator likewise writes truncated message text. The live database query found no public-schema provider/cooldown/Gemini RPC matching those names. No provider-state row values were read.

**Immediate disposition:** keep automated generation/publishing NO-GO until effective grants are corrected and independently verified, safe diagnostic persistence is enforced, and all live callers are migrated to a tested atomic operation. This audit made no production changes. The original migration SQL body remains unavailable in the checked Git branch even though its applied version/name is present in the live ledger; retrieve it from Git history/remote artifact or a trusted deployment record before composing a schema-specific migration. Do not infer it from table metadata alone.
