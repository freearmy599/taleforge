# Aevora Phase 1 — Production Migration Compatibility Matrix (2026-10-14)

## Purpose and safety boundary

This is a **read-only reconciliation plan**, not an authorization to deploy. The live Supabase migration ledger contains 232 entries and ends at `20261010161919_aevora_release_scheduler_leases`. The 19 branch migrations below are not recorded in that ledger. Their absence does not prove that every corresponding schema change is absent from production: live catalog checks already show partial drift (for example, production lease functions exist but still use the older search path). Do not apply these migrations as a batch or use `IF NOT EXISTS` as a substitute for compatibility review.

No production schema, grants, data, cron job, Edge Function, schedule, generation, or publication was changed for this review.

## Branch-only migration inventory

| Migration | Main effect | Compatibility / risk | Required preflight before any rollout |
|---|---|---|---|
| `20261012183000_aevora_release_scheduler_lease_foundation.sql` | Adds the scheduler lease foundation | **High**: object/constraint/function overlap possible because live lease objects already exist from a different recorded migration. | Diff live columns, constraints, indexes, function signatures/owners/ACLs, and lease state; reconcile against the deployed schema and live callers. |
| `20261012190000_aevora_atomic_scheduler_lease_fencing.sql` | Adds atomic lease claim/renew/release fencing | **Critical**: concurrency and scheduler safety; live scheduler v12 does not call the new lease RPCs. | Review the foundation dependency first; prove claim/renew/release behavior under concurrent, expired, wrong-owner, and partial-failure cases; validate cron/Edge Function caller compatibility. |
| `20261013090000_aevora_server_only_metrics_outbox_grants.sql` | Locks attachment metrics and publication outbox to server-only access | **High**: may break legitimate service paths if role grants or callers differ. | Inventory table/column grants, RLS, owners, triggers, and all Edge Function/SQL callers; confirm service-role access and no browser dependency. |
| `20261013103000_lock_internal_narrative_intelligence_tables.sql` | Restricts internal narrative-intelligence tables | **High**: broad list of internal tables; table and column ACLs are independent. | Verify every named relation exists, classify actual callers, and test service-role access for every active planner/generator/reviewer. |
| `20261013110000_restrict_internal_invoker_rpc_execution.sql` | Revokes client EXECUTE on internal invoker RPCs and helpers | **High**: direct browser/RPC dependencies or overload differences could break. | Compare exact function signatures, overloads, trigger attachments, effective grants, and callers. Preserve trigger invocation and trusted service execution. |
| `20261013120000_lock_ai_provider_state_table.sql` | Removes client access and redacts legacy Gemini diagnostics | **High / data-changing**: performs an UPDATE of existing diagnostic rows as well as ACL changes. | Inspect row counts and allowed diagnostic states without exposing raw values; confirm active workers tolerate redacted strings and service-role access remains intact. Prepare a bounded rollback/data-recovery plan. |
| `20261013130000_lock_internal_policyless_tables.sql` | Revokes client grants on internal RLS-enabled/no-policy tables | **High**: can break any overlooked browser, RPC, or authenticated workflow; table list may drift. | Recompute live relation/policy/grant inventory and compare exact table list; prove each is internal and service paths still work. RLS enabled with no policies is default-deny for rows, but broad grants are still unnecessary. |
| `20261013140000_aevora_revision_successor_idempotency.sql` | Rejects duplicate non-winning revision successors and adds a partial unique index | **Critical / data-changing**: updates historical statuses and intentionally aborts on multiple published/approved successors. | Count and inspect duplicate groups by IDs/status only; reconcile ambiguous history manually; verify index predicate and concurrent writes; take a recovery snapshot before any approved application. |
| `20261014100000_lock_unwired_reader_feature_tables.sql` | Denies direct client access to currently unwired reader-feature tables | **High**: could disable features or integrations if dependency inventory is incomplete. | Confirm all browser and server callers, auth/profile flows, notifications, comments, ratings, collections, and reporting paths; agree on product behavior while tables are inaccessible. |
| `20261014120000_lock_public_identity_sequence_grants.sql` | Revokes client access to two public identity sequences | **Medium–high**: insert behavior and identity/sequence configuration need validation. | Confirm actual sequence ownership/defaults and identity semantics; test inserts using anon/authenticated in an isolated environment and verify service paths. Also inspect default sequence privileges. |
| `20261014130000_public_trending_aggregate_rpc.sql` | Adds a SECURITY DEFINER aggregate RPC and rewires the trending view | **Critical**: introduces a public callable privileged function; reader-event spoof/replay can poison scores; function/view contract and grants change. | Security review of every output column and function body; test fixed search path/owner/ACL, view security-invoker behavior, aggregation correctness, spam/replay controls, query cost, and client query compatibility in disposable DB. The RPC does not currently exist in production. |
| `20261014150000_reader_events_insert_only.sql` | Restricts ordinary clients to INSERT on raw reader events | **High**: depends on event-ingest policy and all consumers moving to the aggregate API. Does not itself prevent replay/spam or prove chapter-series relationships. | Verify effective table and column grants, policy predicates, insert contract, chapter-to-series relationship enforcement, and service-role consumers; test insert accepted/rejected cases. |
| `20261014160000_limit_public_content_tables_to_select.sql` | Limits public content tables to SELECT while preserving existing RLS policies | **High**: may remove writes or column-level access relied on by application code; broad grants and column ACLs must be reconciled. | Verify all six relations, policies, column grants, client query shapes, server writers, and published-status filters. Run UI/API smoke tests with anon and authenticated roles. |
| `20261014170000_restrict_public_default_privileges.sql` | Revokes future broad client defaults for tables, sequences, and functions in public | **High; incomplete by design**: current executor is not a member of `supabase_admin`, so that owner is skipped. Existing objects are unaffected. | Resolve an authorized owner-level operation for `supabase_admin`; review its `public` defaults separately from managed `graphql`, `graphql_public`, and `storage` schemas. Test object creation as each owner and inspect effective default ACLs afterward. |
| `20261014180000_revoke_unapproved_internal_client_writes.sql` | Revokes unapproved client write privileges on 41 internal story-design tables | **High**: intentionally changes effective ACLs across internal narrative tables; dependent RPCs/workers must remain functional. | Reconcile the exact relation/column list against live grants, verify all service-role callers, and replay the migration with catalog assertions in a disposable database. |
| `20261014190000_lock_internal_story_design_read_surfaces.sql` | Removes client read paths from the same 41 internal story-design relations | **High**: hides internal design data from browser clients; the source scan found no direct browser dependency but this requires runtime confirmation. | Validate service-role read/write paths, policies, triggers, and all planner/revision-worker dependencies; smoke-test the reader UI separately. |
| `20261014200000_reader_event_relationship_integrity.sql` | Requires every event to identify an eligible series and supplied chapters to match that series and be published | **High**: can reject malformed legacy client payloads; eligible series-only events remain valid. | Rehearse accepted/rejected event pairs, chapter-only payloads, unpublished content, role privileges, and browser event payload compatibility in a disposable database. |
| `20261014210000_release_automation_readiness_gate.sql` | Adds a server-controlled readiness marker, atomic service-only readiness RPC, and inert enrollment defaults | **Critical**: disables existing unready non-manual schedules and requires a coordinated runner/scheduler/publisher/generation rollout. | Rehearse the migration and concurrency tests; confirm callers, schedule disposition, policy state, lifecycle/run evidence, rollback, and manual-review activation behavior. Keep production rollout separately approved. |
| `20261014220000_reader_event_idempotency_key.sql` | Adds nullable client event UUIDs and a partial unique index for retry idempotency | **Medium–high**: does not prevent spoofing or spam with fresh UUIDs; browser clients must reuse a key when retrying. | Replay duplicate-key and legacy-null cases; verify identity/insert-only grants and client error handling; keep the public trending RPC gated until rate limiting and trusted intake are designed. |

## Cross-migration dependencies and order

The order below is a **review sequence**, not a ready-to-run deployment command:

1. **Reconcile the baseline first.** Produce a live-vs-branch catalog diff for every affected table, sequence, index, policy, function overload, owner, default ACL, and effective grant. The migration ledger alone is insufficient.
2. **Resolve privileged function and default-privilege strategy.** Inventory all public SECURITY DEFINER functions without an arbitrary result cap. Review owners, configured search paths, EXECUTE grants inherited through PUBLIC, and actual call paths. Resolve the `supabase_admin` default ACL gap through an explicitly authorized privileged route; do not expand revokes into managed schemas by assumption.
3. **Validate internal-access migrations.** Metrics/outbox, narrative intelligence, internal RPCs, provider-state, and policyless-table restrictions must be tested together because they can change the same callers' effective access.
4. **Validate reader data integrity before publishing trending.** Enforce the chapter-to-series relationship; define replay/spam mitigation; test INSERT-only intake and sequence privileges; then test the aggregate RPC and view contract. Do not expose raw reader-event rows.
5. **Validate revision idempotency separately.** This migration mutates existing statuses. Resolve duplicate approved/published successors manually before the migration can be considered safe.
6. **Validate scheduler lease fencing with its Edge Function changes.** The migration and scheduler/publisher Edge Functions form one compatibility unit. Confirm internal auth headers, lease failure behavior, fencing tokens, idempotent publication, and failure-safe schedule advancement before any rollout.
7. **Run role-based smoke tests and advisors** in an isolated disposable environment; capture before/after grants, RLS policies, function definitions, view contracts, and expected UI/API behavior.

## Explicit production gates

- [ ] Exact live catalog diff reviewed against every migration.
- [ ] All active browser, Edge Function, SQL RPC, trigger, and cron callers mapped to affected objects.
- [ ] No unresolved data-changing migration precondition, especially revision-successor duplicates.
- [ ] SECURITY DEFINER functions reviewed for owner, search path, PUBLIC/client EXECUTE, and data returned.
- [ ] Reader-event relationship integrity and abuse controls tested.
- [ ] Scheduler/publisher/lease rollout tested as one unit with internal auth verified.
- [ ] `supabase_admin` defaults have a separately authorized and verified plan.
- [ ] Disposable-environment migration replay, role-based tests, TypeScript/tests, and advisors pass.
- [ ] Rollback/recovery plan and an explicit deployment approval exist.

**Current decision: NO-GO for applying the 14 migrations as a batch.** Several are promising hardening changes, but the live ledger/catalog drift, caller compatibility, the provider-state data update, revision-successor mutation, public SECURITY DEFINER aggregate, and missing `supabase_admin` privilege path must be resolved first.

## Verification snapshot

- Live migration ledger: 232 entries; latest recorded version `20261010161919`.
- All 14 migration versions listed above are absent from that ledger.
- Branch commit reviewed: `075d8bff532fc4b95b80f56fb31a8ef964c17875`.
- GitHub Actions type-check run `38522406714`: **success**.
- This document records review only. It does not authorize or perform a production change.


## Readiness-gate migration addendum (2026-10-14)

The branch now also contains `20261014210000_release_automation_readiness_gate.sql`, bringing the known branch-only migration set to **19** relative to the recorded live ledger. This new migration is not present in production and has not been applied.

Additional compatibility requirements for this migration:

- It adds `release_schedules.automation_ready_at` and intentionally leaves every existing row NULL; there is no blanket backfill. It also disables every unready non-manual schedule that is enabled or has either automation flag set, so legacy worker versions cannot continue scheduled work in the migration-first rollout gap.
- It replaces the series-enrollment trigger so new/unready schedules remain disabled.
- It adds `taleforge_mark_release_automation_ready(uuid)`, restricted to `service_role`, which verifies the series, schedule configuration, lifecycle row, production policy, and bootstrap audit evidence before atomically setting the readiness marker and automation flags.
- It must be deployed together with the tracked branch version of `autonomous-series-creation-runner`, the scheduler, and the publisher. The production runner remains v6 until a separately approved rollout.
- The migration has passed repository source-contract CI and a disposable PostgreSQL 17 GitHub Actions replay (`38545394445`) with runtime assertions for cleanup, legacy-write rejection, manual-mode compatibility, caller-settable-GUC bypass rejection, RPC-only readiness marking, successful audited activation, completed-series deactivation, and refusal to reuse stale readiness evidence after lifecycle revocation. A separate disposable-PostgreSQL concurrency rehearsal also passed for a series-completion race. It has **not** been replayed against an isolated Supabase environment; Supabase-specific RLS/ACL interactions, broader concurrent schedule-writer/lease-claim interleavings, rollback, and an authorized historical schedule disposition remain open.

The no-go decision remains in force. Do not apply this migration or deploy the related Edge Functions until isolated migration rehearsal, detailed schedule inventory/backfill decisions, caller compatibility, and explicit rollout approval are complete.
