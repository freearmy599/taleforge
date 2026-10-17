# Aevora live publication-gate provenance recheck — 2026-10-17

Scope: read-only Supabase catalog inspection of the live TaleForge/Aevora project. No application rows were queried, and no database or Edge Function changes were made.

## Live routine found

The live catalog contains `public.taleforge_ceo_execution_gate(p_action_scope text)`.

- Owner: `postgres`
- Returns: `jsonb`
- Security mode: `SECURITY DEFINER`
- Function setting: `search_path=public`
- Effective EXECUTE: current SQL executor (`postgres`) = true; `service_role` = true; `anon` = false; `authenticated` = false.
- Explicit ACL from the catalog: `{postgres=X/postgres,service_role=X/postgres}`.
- Body rejects calls unless `auth.role() = 'service_role'`, restricts action scopes to generation, revision, publication, or autonomous_creation, calls `public.taleforge_boss_evaluate(p_action_scope)`, and authorizes only decisions `proceed` or `proceed_with_restrictions`.

The gate's `search_path` is only `public`. The live `public` schema ACL showed USAGE for client roles/PUBLIC but CREATE assigned to `pg_database_owner`, not `anon` or `authenticated`. This narrows the immediate object-shadowing concern, but does not substitute for reviewing all dependencies and schema ownership.

## Source provenance result

The exact routine name was not found by the connected GitHub source search, and the reviewed tracked migration `20261007043000_taleforge_system_governance.sql` creates the governance registry/health/dependency tables and policies but does not define this gate. The function is therefore present in the live catalog, while its defining migration/source provenance remains unresolved in the tracked migration set inspected so far. Do not infer that the function is absent from all possible historical artifacts; continue searching the full migration history and any authorized source archive.

## Related live routine ACL observations

A narrow live catalog query also found:
- `public.aevora_claim_release_scheduler_lease(uuid,uuid,integer)`, `public.aevora_renew_release_scheduler_lease(uuid,uuid,integer)`, and `public.aevora_release_scheduler_lease(uuid,uuid)` are SECURITY DEFINER routines owned by `postgres`, pinned to `search_path=pg_catalog, public, pg_temp`, with EXECUTE for `service_role` and `postgres`, not for `anon` or `authenticated`.
- No live routines matching the branch names `aevora_advance_release_schedule_if_lease_owned` or `aevora_activate_story_lifecycle_if_lease_owned` appeared in the focused live routine-name query. This is consistent with the already-known scheduler lease-fencing migration drift; it is not proof that no differently named equivalent exists.
- `public.touch_story_lifecycle_updated_at()` is a SECURITY INVOKER trigger function with default-style EXECUTE ACLs including client roles. It is a trigger helper, not evidence of direct table-write authorization by itself; retain it for the broader trigger/caller audit rather than changing it in isolation.

## Decision and remaining work

1. Keep automated publishing **NO-GO**.
2. Reconcile the live gate definition against a traceable migration/source artifact before changing it.
3. Decide and implement the separate transaction-bound, per-publication approval contract; the governance gate is not itself proof that a trusted human approved a particular chapter/output.
4. Re-run live routine provenance and ACL checks after an authorized source/owner path is available.

This is a metadata-only audit note, not rollout approval and not proof of end-to-end publication safety.
