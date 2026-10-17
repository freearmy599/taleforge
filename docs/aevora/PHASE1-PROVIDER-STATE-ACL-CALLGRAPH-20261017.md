# Aevora Phase 1 — Provider-state reader/writer ACL inventory

Date: 2026-10-17  
Branch: `aevora/release-scheduler-hardening`  
Scope: static source inventory of Edge Function TypeScript on the hardening branch plus previously recorded read-only live catalog evidence. This is not a deployment authorization.

## Findings

- Static branch scan found **13 Edge Function modules with direct provider-state SELECTs** and **16 query call sites**. `generate-chapter` and `revise-chapter` each query provider state twice because their quality-review/continuation paths have separate guards.
- `aevora-control-plane-audit` is an additional indirect reader via its authenticated, read-only `readTable` helper. It selects only `provider,cooldown_until,consecutive_throttle_count,last_error_at`; it does not select the diagnostic text `last_error`.
- The branch has **10 provider-call-owning functions** calling `aevora_record_gemini_throttle`; no direct `.insert()`, `.update()`, `.upsert()`, or `.delete()` against `taleforge_ai_provider_state` was found in the scanned worker sources. `generation-orchestrator` is intentionally not a second writer.
- All identified direct query callers use a server-side Supabase client/key. This is source evidence, not proof of the deployed secrets, effective grants, or deployed function versions.
- Previously collected read-only live catalog evidence found `anon` and `authenticated` had table-level SELECT/INSERT/UPDATE/DELETE/TRUNCATE privileges on `taleforge_ai_provider_state`; RLS was enabled but not forced. The branch's table-lock migration is not in the observed live migration ledger. Do not claim the live table is fixed.

## Direct SELECT call-site inventory

| Function | Direct SELECT sites | Purpose |
|---|---:|---|
| `arc-planner` | 1 | Preflight before planner provider call |
| `blueprint-planner` | 1 | Preflight before blueprint provider call |
| `character-continuity` | 1 | Preflight before character-canon provider call |
| `continuity-review` | 1 | Preflight before continuity review |
| `generate-chapter` | 2 | Generation and AI quality-review preflights |
| `generation-orchestrator` | 1 | Orchestration cooldown gate |
| `originality-review` | 1 | Preflight before originality review |
| `review-orchestrator` | 1 | Preflight before any review calls |
| `revise-chapter` | 2 | Main revision and continuation preflights |
| `safety-review` | 1 | Preflight before safety review |
| `semantic-continuity-extraction` | 1 | Execute-mode provider preflight |
| `story-dna-planner` | 1 | Preflight before Story DNA provider call |
| `world-continuity` | 1 | Preflight before world-canon provider call |
| **Total** | **16** | **13 direct-reader modules** |

Indirect service-side read:
- `aevora-control-plane-audit`: authenticated audit snapshot selects provider, cooldown, counter, and timestamp fields only.

## Write ownership inventory

The ten direct provider-call owners with atomic throttle RPC calls are:
`generate-chapter`, `revise-chapter`, `continuity-review`, `originality-review`, `safety-review`, `character-continuity`, `world-continuity`, `arc-planner`, `blueprint-planner`, and `story-dna-planner`.

`generation-orchestrator` observes child outcomes and must not re-record the same provider failure. The branch's candidate RPC is SECURITY DEFINER and grants EXECUTE only to `service_role`; its candidate migration is not proof of live installation.

## Least-privilege repair plan — prepared, not applied

1. Keep `anon` and `authenticated` with **no table or column privileges** on `taleforge_ai_provider_state`; RLS alone is not a substitute for revoking TRUNCATE and relation privileges.
2. Until deployed parity proves every writer uses the atomic RPC, retain the currently required server-side table privileges for the deployed worker set. Do not remove server access on the assumption that branch source is already deployed.
3. Once all deployed writer versions are confirmed to use the atomic RPC, remove direct server-side write privileges from ordinary Edge callers and keep state mutation behind the narrowly scoped, audited `aevora_record_gemini_throttle(uuid,text)` function.
4. Consider a narrow `aevora_get_gemini_provider_state()` SECURITY DEFINER read RPC returning only `cooldown_until` and a validated nonnegative integer counter. Before adoption, confirm function ownership, fixed `search_path`, row cardinality, malformed-state behavior, grants, and Supabase PostgREST/Edge Runtime compatibility. Grant EXECUTE only to `service_role`. The audit endpoint can continue reading its own restricted snapshot if separately justified.
5. Review default privileges independently for both `postgres` and `supabase_admin`. The branch repair correctly refuses to proceed when global maintenance defaults cannot be safely overridden; do not bypass this refusal.
6. Apply only through an explicitly authorized, reviewed migration after live schema provenance is reconciled. Verify effective table and column ACLs, default ACLs, function EXECUTE grants, and actual caller behavior afterward.

## Gates that remain open

- Live migration provenance for the provider-state table and reconciliation of the live schema with branch candidates.
- Deployed version parity for `generate-chapter`, `generation-orchestrator`, `revise-chapter`, and the review workers.
- Separate Supabase Edge Runtime validation.
- Explicit approval before any live grant/migration/deployment change.

No database state, ACL, function deployment, provider state, or schedule was changed for this inventory.
