# Aevora Phase 1 — continuation checkpoint (2026-10-16)

## Branch and latest validation

- Working branch: `aevora/release-scheduler-hardening`
- Latest reviewed commit at checkpoint creation: `d378fab0aecc898a3d6c1e027562f7d6d6b42a59` — `test(aevora): track orchestrator cooldown fallback in atomicity gate`.
- Latest validation observed for that commit: [CI run 38863623400](https://github.com/freearmy599/taleforge/actions/runs/38863623400).
  - [Edge Function type-check](https://github.com/freearmy599/taleforge/actions/runs/38863623400/job/116851342381): passed.
  - [Disposable PostgreSQL readiness/security rehearsal](https://github.com/freearmy599/taleforge/actions/runs/38863623400/job/116851342863): passed.
  - [Cloudflare Pages](https://github.com/freearmy599/taleforge/runs/116851397414): passed.
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
