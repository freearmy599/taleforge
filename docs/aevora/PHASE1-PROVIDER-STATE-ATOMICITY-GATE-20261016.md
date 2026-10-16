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


## Expanded live catalog provenance (2026-10-16 continuation)

Follow-up read-only catalog queries completed the key structural portion of the provenance inventory. The live table has exactly one validated constraint, `PRIMARY KEY (provider)`, backed by a valid unique B-tree index on `provider`. No user-defined triggers and no RLS policies were found on the table. No column-level ACL entries were found; the broad relation-level grants are therefore the material direct-access problem observed in the earlier ACL query.

The provider-state migration-history search across GitHub's commit path API returned no commits for `supabase/migrations/20261007025751_add_taleforge_ai_provider_cooldown_state.sql`; the file is absent from the checked hardening branch and from `main`. The live migration ledger still records the version/name as applied. This supports treating the original SQL body as an artifact-recovery gap, not assuming it can be recovered from the repository's current tracked history.

Global/schema default-privilege catalog output shows defaults owned by `supabase_admin` that grant table privileges to `anon`/`authenticated`, and function EXECUTE to `PUBLIC`, `anon`, `authenticated`, and `service_role`. Defaults owned by `postgres` also contain broad table and function grants. This is a separate forward-looking hardening concern: a table-specific REVOKE alone does not prevent future objects from receiving unsafe default grants. The existing default-privilege repair migration is also not in the live migration ledger seen earlier, so its production effect must not be assumed.

**Implementation readiness update:** schema shape, key/uniqueness, no-trigger/no-policy status, ACLs, and relevant default-privilege evidence are now captured. The exact original table-creation migration body remains unavailable, but a *new forward-only migration* can be designed against this verified live catalog without recreating or altering the table definition. It must be rehearsed against a faithful disposable fixture and must not be applied to production as part of this task. Before locking down `service_role` table writes, complete the repository-wide writer inventory and migrate every writer; otherwise a partial lock can break production workers.


## Repository-wide caller inventory — 2026-10-16 continuation

A read-only source scan of the repository tree at commit `01960c57de0dc5766ff96b479f501f1bb90e58d8` expanded the caller inventory beyond the two primary generation functions.

### Direct writer-capable paths

- `generate-chapter/index.ts`: cooldown reads in generation preflight and quality-review path; read/compute/upsert throttle recording.
- `generation-orchestrator/index.ts`: cooldown reads plus `recordGeminiThrottle` read/compute/upsert.
- `revise-chapter/index.ts`: provider block reads and its own `recordGeminiThrottle` read/compute/upsert; called from multiple provider-error paths.
- `continuity-review/index.ts`: cooldown-recording logic reads existing state, computes count/deadline, and writes state; also reads cooldown before review work.
- `originality-review/index.ts`: same pattern: local cooldown writer plus preflight reader.
- `safety-review/index.ts`: same pattern: local cooldown writer plus preflight reader.

### Additional reader

- `review-orchestrator/index.ts`: reads provider state to gate review work. No write match was found in the inspected file.

### Scope and caveats

This is a source inventory from the named repository snapshot, not proof that the deployed versions match these sources. The source search did not inspect every file in every application surface, SQL routine, view, trigger, or production-only function. The live catalog previously showed no user-defined triggers or provider-named routines in the queried scope, but indirect and differently named access must still be reconciled.

**Implementation consequence:** the shared atomic operation must replace all six direct writer-capable paths, not merely `generate-chapter` and `generation-orchestrator`. The final source-contract test must fail if any direct writer remains. Reader-only paths can retain read access only through a verified trusted-server boundary; do not solve this by leaving broad client grants in place.

### Next implementation gate

1. Inventory every direct write occurrence and confirm all live function versions against the branch.
2. Define one typed RPC contract and a documented duplicate-observation policy; no idempotency claim without stable event identity.
3. Implement forward-only migration and update all six writer paths together on the branch.
4. Add source-contract checks that forbid direct table writes and check every read path's fail-closed behavior.
5. Rehearse migration, effective ACLs, concurrent first insert, exact concurrent increments, cooldown monotonicity, malformed state, and rollback/failure behavior in disposable PostgreSQL.
6. Recheck branch CI. Do not apply production migrations or deploy functions as part of this continuation.


## Writer semantics comparison — follow-up review

The additional writer implementations share the same risk class but do not share identical failure semantics:

- `revise-chapter` returns `null` when cooldown persistence fails; callers can still return a provider-error response without proving the cooldown was recorded.
- `continuity-review` and `safety-review` log persistence failure and return from their recording helper rather than propagating a typed persistence failure to the caller.
- `originality-review` has the same helper shape in the inspected source; the local count/cooldown is computed before the upsert.
- The reviewed implementations commonly coerce or normalize the prior counter in application code (including fallback-to-zero patterns), which can mask malformed persisted state instead of making it an explicit database error.
- The cooldown formula is duplicated across functions: HTTP 503 overload proposes one hour; HTTP 429 / `RESOURCE_EXHAUSTED` uses exponential backoff beginning at six hours and capped at 24 hours. Existing cooldown is locally preserved with `Math.max`, but that is not atomic against concurrent writes.
- Diagnostic strings vary by writer. The replacement RPC should persist only an allowlisted diagnostic enum/string and never accept arbitrary provider text.

These findings strengthen the fail-closed contract: throttle recording must return a typed result that callers check. If persistence fails, the operation must not report that the cooldown was safely recorded, and any caller about to make another provider request must stop rather than assuming the guard worked. Keep the existing provider-error response semantics separate from the persistence outcome so the API does not falsely claim persistence success.

### Required source-contract assertions

- No direct `.upsert`, `.insert`, `.update`, or `.delete` to `taleforge_ai_provider_state` remains in Edge Function code after migration.
- Every provider request path checks a provider-state read/RPC result and fails closed on lookup or malformed-state errors.
- Every throttle-recording call checks the RPC result and distinguishes persisted, already-active/ignored-by-policy, and persistence-failed outcomes.
- Only a closed set of event classifications and fixed diagnostic values can reach the RPC.


## Deployed-versus-branch drift check — live Edge Functions, 2026-10-16

A read-only inspection of the currently deployed Edge Function source changed the scope assessment. The earlier six-writer inventory is valid for the checked-in branch snapshot, but it must not be represented as the deployed writer count.

### Live deployed versions checked

| Function | Deployed version | Provider-state behavior observed |
|---|---:|---|
| `generate-chapter` | 59 | Reads state before generation and quality review; directly reads/counts/upserts on Gemini throttle. Persists a raw error substring in `last_error`. |
| `generation-orchestrator` | 35 | Reads state; directly reads counter and upserts throttle state. Persists arbitrary message text. |
| `revise-chapter` | 40 | Reads state before revision; directly reads counter and upserts throttle state. Persists arbitrary message text. |
| `continuity-review` | 10 | Read-only provider-state guard found; no direct writer found in the deployed source inspected. |
| `originality-review` | 9 | Read-only provider-state guard found; no direct writer found in the deployed source inspected. |
| `safety-review` | 9 | Read-only provider-state guard found; no direct writer found in the deployed source inspected. |
| `review-orchestrator` | 11 | Read-only provider-state guard found; no direct writer found in the deployed source inspected. |

The deployed versions and hashes were read from Supabase's Edge Function metadata. This was a read-only inspection; no function was deployed or changed.

### Consequence

The immediate deployed atomic-writer migration scope is **three confirmed direct writers**: `generate-chapter` v59, `generation-orchestrator` v35, and `revise-chapter` v40. The checked-in branch contains additional writer logic in three review functions, so branch/deployed drift must be resolved deliberately: do not blindly deploy the branch versions, and do not assume the extra branch writers are deployed. Preserve the seven-function reader/writer review set above, then perform a full deployed function inventory before changing grants.

The deployed `generate-chapter` and `generation-orchestrator` paths shown in this inspection have simpler checks than the hardened branch source; in particular, the live code shown does not perform the same complete malformed-state/cooldown-monotonicity checks documented for the branch. Deployed `revise-chapter` also has a direct read/compute/upsert path. Raw provider error text is still written by these three deployed writers. These are confirmed live blockers.

### Revised next gate

1. Keep the full checked-in source inventory as a branch migration checklist, but distinguish deployed behavior from branch behavior in all reports.
2. Implement one shared atomic RPC and migrate the three confirmed deployed writers in the source branch; retain the extra branch writer paths only if they are actually intended to be deployed, otherwise remove or migrate them before release.
3. Before any production deployment, inspect every currently deployed function for table references, including functions not in the seven-function subset above.
4. Test raw diagnostic redaction by preventing raw input from reaching the RPC rather than relying on a future cleanup UPDATE.
5. Verify deployed source/version after an explicitly approved rollout; do not revoke trusted service-role table writes before all live writers are migrated.


## Fresh read-only live recheck (2026-10-16 continuation)

A new authorized read-only Supabase query and Edge Function metadata/source fetch were performed for project `sxmbnlgufqhcwxcpcsvb`. No provider-state row values were read and no writes/DDL/RPC execution were performed.

### Current live table ACL and default ACL evidence

The direct `pg_class` result for `public.taleforge_ai_provider_state` is:

- Owner `postgres`; RLS enabled; FORCE RLS disabled.
- Effective relation ACL text: `postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres`.
- This is a direct grant-level exposure for `anon` and `authenticated`; RLS is not a substitute for revoking unnecessary table privileges, and `TRUNCATE` is not governed by row policies.

The fresh `pg_default_acl` query again returned broad defaults in schema `public` for both owners:

- `postgres`: tables `arwdDxtm`, sequences `rwU`, functions `X` granted to `anon`, `authenticated`, and `service_role` in addition to owner.
- `supabase_admin`: the same broad object defaults under its ownership.

This confirms the future-object exposure is not limited to the existing provider-state relation. It must be corrected owner-by-owner through an approved path; do not bypass role membership or apply a broad speculative default-privilege change.

### Current live routine inventory

Two read-only catalog searches were run: (1) function bodies in `public`, `taleforge_internal`, and `aevora_private` containing the provider-state relation/column names; and (2) public function names matching provider/cooldown/Gemini. Both returned no matches. This supports the absence of a visible narrow database RPC for this purpose, but is not proof that no differently named routine or non-public caller touches the table.

### Exact live Edge Function fingerprints and call sites

The current deployed metadata/source fetch reports:

- `generate-chapter` v59, SHA-256 `9f6d57c77bba109cd079dd9441963e3f4ab3aed6ab8e0db2aab1ff2129522131`.
  - Direct provider-state preflight reads at source lines 46 and 102.
  - Direct read/compute/upsert writer at lines 164–168.
  - The writer computes `Number(data?.consecutive_throttle_count ?? 0) + 1` and writes `message.slice(0,2000)` to `last_error`; the read result's error is not visibly checked in the recorded writer snippet. This can silently treat a failed/missing lookup as a fresh counter and preserves raw error text in the provider table.
- `generation-orchestrator` v35, SHA-256 `2f96e3cca526f2c6801860fe7b6cf5456b528ba56ed964f4d5afd71c8569f8e6`.
  - Cooldown preflight read at lines 26–29.
  - Direct read/compute/upsert writer at lines 31–37.
  - The writer does not check the read or upsert error in the returned snippet and stores truncated arbitrary error text. The preflight treats query errors as active/blocked, which is fail-closed for the check but does not repair the writer path.

These are deployed-source observations for the fetched versions, not just branch estimates. The two writers remain non-atomic and their callers are not yet migrated to a common database operation.

### Updated gate decision

The provider-state repair is **still blocked**. There is now fresh confirmation of the broad direct ACLs, broad future-object defaults, no matching provider-named public routine, and deployed writer fingerprints. The remaining prerequisite is authoritative original creation/deployment provenance plus a complete reader/writer call graph. After that, implement the atomic operation and concurrency tests on the branch/disposable PostgreSQL only. No production migration, grant, function deployment, or provider-state data change was performed.


## Complete deployed Edge Function reference scan — 2026-10-16 continuation

A read-only source scan fetched all **26 currently listed deployed Edge Functions** from the Supabase Edge Function inventory and searched source files for `taleforge_ai_provider_state`, `cooldown_until`, `consecutive_throttle_count`, and `last_error_at`. This was source inspection only; no function was invoked, deployed, or changed.

### Functions with provider-state references

**Three confirmed direct writers:**
- `generate-chapter` v59 — direct preflight reads and non-atomic read/compute/upsert; persists truncated raw provider error text.
- `generation-orchestrator` v35 — direct cooldown reads and non-atomic read/compute/upsert; persists truncated arbitrary error text.
- `revise-chapter` v40 — direct cooldown reads and non-atomic read/compute/upsert; persists truncated arbitrary error text.

**Ten additional source files with read-only references in the fetched versions:**
- Review gates: `continuity-review` v10, `originality-review` v9, `safety-review` v9, `review-orchestrator` v11.
- Planning/continuity gates: `blueprint-planner` v13, `story-dna-planner` v7, `arc-planner` v11, `character-continuity` v5, `world-continuity` v9, `semantic-continuity-extraction` v8.
- `aevora-control-plane-audit` v4 references the table in its read-only operations snapshot.

The scan found no matching provider-state column/relation references in the remaining deployed function source files fetched: `publication-review` v8, `release-publisher` v21, `release-scheduler` v12, `post-publication-canon-sync` v6, `publication-sync-processor` v4, `chief-editor-monitor` v8, `autonomous-series-creation` v5, `autonomous-series-creation-runner` v6, `aevora-operations-snapshot` v5, `aevora-cover-worker` v4, `aevora-cover-request` v5, and `aevora-cover-review` v4. The inventory contained 26 functions in total. This is a literal source-reference scan, not proof that these functions cannot access the table through a shared helper, indirect RPC, or dynamic SQL.

### Revised migration sequencing

1. Migrate the three confirmed deployed writers to one atomic database operation and safe fixed diagnostics.
2. Preserve the ten read-only caller paths during privilege redesign. Confirm their exact behavior, including error/missing-row handling, before switching them to a narrow reader RPC or another verified server-only path.
3. Reconcile branch-only writer logic in `continuity-review`, `originality-review`, and `safety-review`; do not deploy these branch snapshots without deliberate parity review.
4. Only after all deployed writer/read paths are verified should a separate least-privilege migration revoke direct table privileges. Keep service-role direct writes until writer migration and deployed-version verification are complete.
5. Re-run the inventory immediately before rollout because the deployed function list and versions can change.

**Disposition:** inventory coverage is now 26/26 deployed Edge Function source files fetched and scanned. Atomic implementation, branch caller changes, disposable PostgreSQL concurrency tests, runtime compatibility validation, and production authorization remain incomplete. Production remains unchanged and automated publishing remains **NO-GO**.


## Migration-file provenance follow-up — 2026-10-16

A targeted repository path check located `supabase/migrations/20261013120000_lock_ai_provider_state_table.sql` on this branch (blob SHA `faf428de57cf56935db018224a2d8f698183d850`). This is a branch migration file, not evidence it ran in production: the live migration ledger does not contain version `20261013120000`.

The file enables RLS, rewrites legacy `last_error` values for the Gemini row, and revokes relation and column privileges from `PUBLIC`, `anon`, and `authenticated`. It does not implement atomic cooldown writes, migrate the three deployed writers, or repair broad default privileges for future objects. Its substring-based legacy diagnostic rewrite needs a reviewed data-impact rehearsal before any production use. Do not apply it as a substitute for atomicity repair.

The original creation migration `20261007025751_add_taleforge_ai_provider_cooldown_state.sql` was not found at the expected `supabase/migrations/` path or by repository code search. The live ledger confirms the version was applied, but its original SQL body remains unrecovered from the checked branch. This remains unresolved provenance, not proof that no copy exists elsewhere.

**Decision:** retain the existing `20261013120000` file as an unapplied candidate requiring review; do not deploy it independently. Atomic writer migration and default-privilege remediation remain separate work items.


## Branch-source comparison — 2026-10-16

Current branch files were fetched for the three writer paths. `generate-chapter/index.ts` blob `9bb41d89d283e7934ad535499930b00c4f1e60b2` has fail-closed preflight reads and a direct read/compute/upsert writer. `generation-orchestrator/index.ts` blob `b1accc29fcedb6a37d7b44b9b0fadbca254e36d6` blocks on missing/error state and malformed counters/timestamps, but still writes directly. `revise-chapter/index.ts` blob `7a77316e9236a312ac37d145e7963146ce4a6593` also has fail-closed preflight checks and a direct read/compute/upsert writer. These are branch blob IDs, not deployed hashes.

Branch source is safer in some paths than deployed versions, but all three still have non-atomic writes. Do not deploy these older branch snapshots wholesale. Implement against an explicit deployed-versus-branch diff, preserve required preflight behavior, and add source-contract tests proving migrated throttle paths use only the approved database operation. Caller behavior must distinguish persisted success from persistence failure; do not claim idempotency without a stable event identifier.


## Atomic RPC implementation draft — 2026-10-16 continuation

A branch-only forward migration candidate was added at `supabase/migrations/20261016180000_atomic_gemini_provider_throttle.sql`. It creates `public.aevora_record_gemini_throttle(text)` with a fixed `quota|overload` input allowlist, fixed diagnostics, a single `INSERT ... ON CONFLICT DO UPDATE`, DB-side counter increment, monotonic cooldown via `GREATEST`, rejection of negative persisted counters, and execute permission limited to `service_role`. The RPC returns an explicit `recorded` result with the persisted counter and cooldown. It does not accept raw error text and does not claim idempotency: every successful invocation is one observation, and duplicate caller observations remain possible without a stable event ID.

The three branch writer paths were changed to call this RPC and to treat a missing/failed persistence confirmation as failure:
- `generate-chapter/index.ts` — direct read/compute/upsert throttle writer replaced by RPC call; existing preflight and quality-review guards were not intentionally changed.
- `generation-orchestrator/index.ts` — fallback writer uses the RPC and retains its best-effort active-cooldown check to reduce duplicate observations when a child worker already recorded the same event. This check is not an idempotency guarantee.
- `revise-chapter/index.ts` — direct read/compute/upsert throttle writer replaced by RPC call; existing provider preflight paths remain in place.

Added source-contract tests at `scripts/tests/aevora-provider-state-atomicity-contract.test.mjs`. The tests assert RPC security declarations, fixed event/diagnostic allowlists, atomic upsert/counter/cooldown patterns, absence of direct provider-state writes in the three callers, and explicit persistence-confirmation checks.

### Validation still required (not claimed complete)

- Run the source-contract test under the repository's supported Node test environment and verify its file paths against the actual checkout.
- Apply the candidate migration only to a disposable PostgreSQL database with the verified table shape; test first insert, sequential quota delays (6/12/24 hours), 503 overload (1 hour), monotonic cooldown, invalid event class, negative counter rejection, counter overflow, and rollback on failure.
- Use multiple concurrent database sessions to prove exact final counter increments and no cooldown shortening.
- Verify function owner, effective ACLs, SECURITY DEFINER behavior, fixed search path, and execution as service_role versus anon/authenticated.
- Run Deno/Edge Runtime checks and the complete branch validation suite.
- Review duplicate observation behavior between child writers and the orchestrator, and complete the deployed-versus-branch parity diff before any deployment proposal.

**Safety boundary:** this migration and caller code are unmerged branch candidates only. No production SQL, grant, Edge Function deployment, generation, publication, or schedule mutation was performed. The existing broad table/default ACL findings and original migration provenance remain unresolved. The new RPC does not by itself close the production security gate; production remains **NO-GO**.
