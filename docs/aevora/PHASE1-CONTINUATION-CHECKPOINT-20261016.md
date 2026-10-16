# Aevora Phase 1 — continuation checkpoint (2026-10-16)

## Branch and latest validation

- Working branch: `aevora/release-scheduler-hardening`
- Latest checkpoint refresh commit before this edit: `e8239f601cb105af9a59c5ae7b2d178678fae5a2c` — `docs(aevora): refresh phase one continuation checkpoint`.
- Latest validation observed: [CI run 38868044595](https://github.com/freearmy599/taleforge/actions/runs/38868044595) on parent commit `de13b0ccc3e4c35b3b26bffc574db13971b22d6f`.
  - [Edge Function type-check](https://github.com/freearmy599/taleforge/actions/runs/38863623400/job/116851342381): passed.
  - [Disposable PostgreSQL readiness/security rehearsal](https://github.com/freearmy599/taleforge/actions/runs/38863623400/job/116851342863): passed.
  - [Cloudflare Pages](https://github.com/freearmy599/taleforge/runs/116851397414): passed.
- Latest run 38868044595 completed successfully: both Edge Function type-checking/source-contract checks and disposable PostgreSQL readiness/security rehearsal passed. This run validates parent commit `de13b0c`; the current documentation-only checkpoint refresh still requires its own CI run.
- These checks validate the branch test fixtures and prepared source only. They are not evidence that production migrations or Edge Functions were deployed.

## Confirmed hardening on the branch

- Scheduler's explicit stop for real `auto_publish` work remains in place. Automated publication is blocked before lease claims/publisher HTTP calls until a database commit-boundary authorization transaction is implemented and approved.
- Publisher fail-closed checks and strict publication-status validation remain in scope; a separate database transaction is still required to make chapter, series, schedule cursor, and publication outbox state atomic.
- Provider-state ACL migration and default-privilege migration have disposable PostgreSQL rehearsals. Tests cover broad relation/column grants, client denial including `TRUNCATE`, retained trusted server grants, diagnostic redaction, and newly created table/sequence/function defaults.
- The latest branch also has a catalog-only publication schema inventory and a contract test that rejects mutation statements. The inventory has not been treated as proof of live schema compatibility.
- Gemini cooldown atomicity gate now explicitly includes the orchestrator fallback as well as direct worker cooldown-recording paths.

## Live schema findings that remain open

See [live schema reconciliation findings](./phase1-live-schema-reconciliation-findings-2026-10-16.md) and [reconciliation runbook](./phase1-live-schema-reconciliation-runbook.md).

1. **Provider-state migration history is not reconciled.** Live ledger evidence contains a provider-state creation version, but the corresponding original migration body is absent from current `main` and the hardening branch. Do not fabricate a historical migration or mark it applied to align the lists.
2. **Provider-state client grants were observed live.** The table-specific lock migration is not recorded as applied in the observed live ledger. Do not apply it blindly; resolve provenance, compatibility, and rollout authorization first.
3. **Future-object defaults are not fully locked.** The migration executor cannot administer the `supabase_admin` defaults. That owner-level correction needs separately authorized review and verification.
4. **Cooldown recording is not atomic.** A read/modify/upsert can lose concurrent throttle increments. No guessed RPC signature or migration is permitted until canonical schema and migration provenance are reconciled.
5. **Publication commit-boundary transaction is not implemented.** Exact column types, constraints, unique indexes, triggers, ownership, ACLs, and outbox invariants must be reconciled before a transactional RPC can be designed safely.
6. **Legacy automatic schedules require disposition.** The six identified candidates need individual review and explicit decisions before any automation can be re-enabled.
7. **Supabase Edge Runtime validation and deployed drift checks remain separate release gates.** Local TypeScript/CI success does not establish deployed behavior.

## Non-negotiable safety boundary

- Production remains **NO-GO** for automated publication and for any unreviewed migration rollout.
- No production migration/deployment, schedule mutation, generation/publication, or billable Supabase branch is authorized by this checkpoint.
- Preserve fail-closed guards. Do not remove the scheduler publication stop to make a workflow appear green.
- Use only an already-authorized read-only SQL session for schema evidence. Never put credentials or application row payloads in chat or source control.

## Next work sequence

1. Keep CI green while strengthening branch-only contracts and disposable PostgreSQL rehearsals.
2. Reconcile the original provider-state migration source and owner-level default privileges through approved records; do not guess.
3. Obtain reviewed, sanitized publication/provider catalog evidence and reconcile it with tracked migration history.
4. Only then prepare narrowly scoped atomic routines and run concurrency, rollback, ACL, and Edge Runtime validation.
5. Review the six legacy schedule candidates individually and keep each unapproved candidate inactive.
6. Publication catalog follow-up: live `public` contains the 12 core relations listed in the findings document, all RLS-enabled; `aevora_private` is absent, as are `public.reader_event_quota_buckets` and `public.reader_event_quota_cleanup_state`. Reconcile these missing objects against migrations and deployed callers before assuming they should exist or designing publication RPCs.


## Continuation update — 2026-10-16 (latest)

- Caller audit and checklist correction commits:
  - [`2698438`](https://github.com/freearmy599/taleforge/commit/2698438a7dc00d56abe5fc7908ad03e8a69f069a): initial caller audit update; CI run [38933991376](https://github.com/freearmy599/taleforge/actions/runs/38933991376) passed.
  - [`ed7664b`](https://github.com/freearmy599/taleforge/commit/ed7664b9a9f884a85a3ff23133b29b040c395c7a): reconciled full 11-writer inventory; CI run [38934087576](https://github.com/freearmy599/taleforge/actions/runs/38934087576) passed.
  - [`5c03b09`](https://github.com/freearmy599/taleforge/commit/5c03b09dcd03585d2767f6f6c83c080f4bd83c62): clarified stable event-ID contract.
  - [`8413a0b`](https://github.com/freearmy599/taleforge/commit/8413a0bfbec3e980ab9bd12075f7506d5ec50a66): corrected the master checklist to supersede older throttle assumptions. CI run [38934201055](https://github.com/freearmy599/taleforge/actions/runs/38934201055) was still in progress at last observation; do not mark it green until it completes.
- Full branch-tree inspection found 21 Edge Function TypeScript entrypoints and 11 writer functions: ten direct provider-call owners (`generate-chapter`, `revise-chapter`, `continuity-review`, `originality-review`, `safety-review`, `character-continuity`, `world-continuity`, `arc-planner`, `blueprint-planner`, `story-dna-planner`) plus the `generation-orchestrator` fallback writer.
- **Important contract correction:** overload events must not increment or reset the quota escalation counter. They must establish at least a one-hour cooldown without shortening a longer existing cooldown. Duplicate observations must be deduplicated atomically using one stable event ID per provider-call attempt, propagated to any parent fallback.
- The current branch candidate migration `20261016180000_atomic_gemini_provider_throttle.sql` is **not compliant with this corrected contract yet**: it increments the counter for overload and has no event ID / event ledger. The existing green tests validate the previous candidate semantics, not the corrected contract. Do not cite earlier green tests as proof of the new contract.
- Updated references:
  - [Gemini throttle contract](./PHASE1-GEMINI-THROTTLE-CONTRACT-20261016.md)
  - [Gemini throttle caller audit](./PHASE1-GEMINI-THROTTLE-CALLER-AUDIT-20261016.md)
  - [Master completion checklist](./MASTER-COMPLETION-CHECKLIST-20261016.md)
- Next implementation task: update the candidate RPC and disposable PostgreSQL rehearsal to use an event ledger and quota-only counter semantics; propagate one event ID through all direct writers and the generation-orchestrator fallback; then update static contracts and run CI. Keep all changes branch-only until provenance, runtime, ACL, and separate rollout gates pass.


## Latest implementation continuation — 2026-10-16

- Added branch-only candidate migration `20261016190000_idempotent_gemini_provider_throttle.sql` with a UUID event ledger, quota-only counter escalation, one-hour minimum overload cooldown, monotonic cooldown expiry, fixed diagnostics, and service-role-only function execution.
- Updated all ten direct provider-call owners to supply `p_event_id`; removed the `generation-orchestrator` fallback writer to prevent duplicate counting of a child failure.
- Updated static source contracts and disposable SQL/shell rehearsal. The rehearsal now tests mixed concurrent events, concurrent replay of one event ID (expected one increment), distinct concurrent quota events (expected 20 increments), overload counter invariance, and role grants.
- **Validation not yet confirmed:** no claim that CI or disposable PostgreSQL passed for these latest edits. The next step is to inspect the workflow run triggered by these commits, fix any failures, and rerun until green. The previous green run validated older semantics only.
- No production migration, deployment, generation, publication, schedule mutation, or billable Supabase branch was initiated. Automatic publishing remains NO-GO.
