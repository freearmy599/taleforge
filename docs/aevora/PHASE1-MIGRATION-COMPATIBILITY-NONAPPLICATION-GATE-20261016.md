# Aevora Phase 1 — Migration Compatibility and Non-Application Gate (2026-10-16)

Status: **review required; no production migration is authorized by this document**.

Branch: `aevora/release-scheduler-hardening`  
Repository head audited: `5f4acda893e5e6076454bc81c5d407160eacfffd`  
Scope: branch migrations dated 2026-10-13 through 2026-10-16 that materially change privileges, schedule state, reader-event intake, or public ranking.

## Evidence baseline

- CI run [38902533143](https://github.com/freearmy599/taleforge/actions/runs/38902533143) passed both Edge Function/source-contract validation and disposable PostgreSQL readiness-migration rehearsal.
- The read-only live audit recorded broad `anon`/`authenticated` relation grants on provider state and several publication/control-plane tables.
- The live reader-event table has seven columns and no `event_uuid`; live function inventory did not include `reader-event-intake`; the expected intake RPC and quota tables were not found.
- The selected live migration-ledger query did not show the branch's later migrations. This is evidence of drift, not a complete authoritative deployment history. Reconcile against the authoritative migration ledger before concluding any migration was never applied.
- A successful disposable-database rehearsal establishes that the tested SQL works in that rehearsal, not that it is safe to apply against current production data, role memberships, triggers, traffic, or schedule state.

## Migration-by-migration disposition

| Migration | Main effect | Current disposition |
|---|---|---|
| `20261013090000_aevora_server_only_metrics_outbox_grants.sql` | Enables RLS and revokes relation/column privileges on metrics and publication outbox tables. | Candidate for staged privilege hardening only after exact caller inventory, rollback, and production schema reconciliation. Do not apply in bulk. |
| `20261013120000_lock_ai_provider_state_table.sql` | Enables RLS, rewrites existing Gemini diagnostic values, revokes client relation/column privileges. | **Hold.** Data rewrite is irreversible without a separate protected pre-change evidence capture; first verify source/deployment history and confirm all trusted worker paths. |
| `20261013130000_lock_internal_policyless_tables.sql` | Enables RLS and revokes broad client grants across numerous internal tables. | Candidate only after table-by-table service-role/routine/trigger caller map. Its table list is broad; verify every relation exists and no approved client surface depends on it. |
| `20261014100000_lock_unwired_reader_feature_tables.sql` | Removes client access to bookmark, collection, comment, notification, profile, rating, history, recommendation and report tables. | Hold until deployed frontend and connected integrations are confirmed. Branch audit suggests many are not wired, but branch source alone is not exhaustive proof. |
| `20261014130000_public_trending_aggregate_rpc.sql` | Adds SECURITY DEFINER aggregate RPC over reader events and published content. | **Do not expose/enable yet.** Review the complete function body, final EXECUTE ACLs, event semantics, query cost/DoS bounds, spoofable visitor hints, and data consistency. Current frontend gracefully degrades; ranking remains gated. |
| `20261014150000_reader_events_insert_only.sql` | Revokes broad reader-event grants and restores INSERT only. | **Blocked by intake transition gate.** Direct browser INSERT remains the compatibility path while intake feature flag is false. Confirm replacement path end-to-end before removing direct INSERT. |
| `20261014160000_limit_public_content_tables_to_select.sql` | Revokes client privileges then grants SELECT on series, chapters, stories, genres, tags, story_tags. | Candidate only after complete browser/query inventory and verification that current RLS policies cover every listed table. Do not infer that all six have compatible policies from series/chapters evidence. |
| `20261014170000_restrict_public_default_privileges.sql` | Revokes default table/sequence/function grants for postgres and supabase_admin where executor is a member. | **Not sufficient by itself.** It deliberately skips `supabase_admin` when executor lacks membership. Requires a separately authorized owner-context operation and proof of effective defaults for both owners. Do not bypass role membership. |
| `20261014180000_revoke_unapproved_internal_client_writes.sql` | Revokes client write-related grants across a long list of narrative-design tables, retaining SELECT. | Candidate only after per-table read-surface and trusted caller mapping. Retaining SELECT is not an approval of client reads. |
| `20261014210000_release_automation_readiness_gate.sql` | Adds readiness authorization, creates triggers, revokes schedule client grants, and **disables existing schedules/automatic flags where readiness is null**. | **Hard hold — operationally state-mutating.** Never apply as a routine security migration. Requires explicit schedule disposition, dry-run counts, owner approval, rollback rehearsal, and a separately authorized maintenance window. No schedule changes are permitted in this phase. |
| `20261014220000_reader_event_idempotency_key.sql` | Adds nullable event UUID and partial unique index to reader events. | **Blocked** until live schema provenance and intake transition are resolved; live table currently lacks this column. |
| `20261015120000_reader_event_intake_rpc.sql` | Creates private quota tables and SECURITY DEFINER intake/cleanup RPCs. | **Blocked** until function bodies, concurrency/idempotency, cleanup bounds, RLS/ACLs, endpoint deployment, and rollback are validated. Live expected RPCs/tables were absent in the read-only audit. |
| `20261016180000_atomic_gemini_provider_throttle.sql` | Adds the shared SECURITY DEFINER RPC for atomic Gemini quota/overload cooldown recording. | **Branch candidate; disposable PostgreSQL rehearsal passed in CI run [38922139195](https://github.com/freearmy599/taleforge/actions/runs/38922139195).** Both direct generation and orchestration/review workers now call the RPC. Still hold from production until the missing original provider-state migration provenance, live ACL/default-privilege drift, Edge Runtime result behavior, duplicate-observation semantics, rollback, and rollout authorization are resolved. |

## Cross-cutting safety findings

1. **CI green is necessary, not deployment authorization.** The tests exercise branch source and disposable PostgreSQL; they do not certify production data, grants, owner membership, active callers, or schedules.
2. **Do not batch-apply all hardening migrations.** They have different risk classes: privilege revocation, data rewrite, schema changes, new SECURITY DEFINER API, and schedule-state mutation.
3. **Default ACLs need owner-specific proof.** The branch migration intentionally skips `supabase_admin` if the executor is not a member. This is a known residual gap, not a reason to escalate or bypass membership.
4. **Reader-event transition remains blocked.** Do not flip `window.taleForgeReaderEventIntakeEnabled`, deploy the new endpoint, or revoke direct INSERT as part of this read-only continuation.
5. **Release automation remains NO-GO.** The readiness migration changes live schedule flags by design; the scheduler/publisher authorization and atomic publication boundary remain incomplete. No scheduler activation or publication should be inferred from CI.
6. **Provider cooldown atomicity remains unresolved.** Existing worker paths use read-modify-upsert; the branch migration that revokes provider-state client grants does not make cooldown updates atomic.

## Safe next sequence

1. Obtain an authoritative migration-ledger export and exact deployed function/source fingerprints.
2. Re-run read-only catalog checks for every relation, owner, RLS policy, relation and column ACL, sequence ACL, routine EXECUTE ACL, trigger, and default ACL referenced by the proposed migrations.
3. Complete the trusted caller map for each table before removing any grants.
4. Split changes into independently rehearsed, reversible rollout units. Keep data rewrites and schedule mutation out of the first privilege-only rollout.
5. For the reader-event path, prove endpoint deployment, RPC existence, response behavior, rate limits, idempotency and controlled frontend event capture before changing the flag or direct grants.
6. For release automation, keep publication disabled until trusted caller authorization, atomic publication transaction, lease integration, duplicate-race handling, and rollback are all verified.

## Change boundary

This document records code review and prior read-only evidence only. It does not authorize production DDL, migration application, grants/policies, feature-flag changes, scheduler changes, generation, or publication.


## Atomic provider-throttle candidate verification (2026-10-16)

CI run [38922139195](https://github.com/freearmy599/taleforge/actions/runs/38922139195) passed both jobs. The new disposable PostgreSQL rehearsal applied the candidate throttle migration to a fixture table, ran 20 concurrent quota RPC calls from an empty table, verified the final count, checked that ordinary client roles cannot execute the RPC while `service_role` can, verified fixed diagnostic text, confirmed a shorter overload does not reduce a longer active cooldown, checked the one-hour overload duration, and verified invalid event classes and a negative persisted counter fail without normalizing state. The Edge Function/source-contract suite also passed. These results validate the branch candidate in a disposable environment only; they do not resolve the original provider-state migration provenance or authorize any production changes.
