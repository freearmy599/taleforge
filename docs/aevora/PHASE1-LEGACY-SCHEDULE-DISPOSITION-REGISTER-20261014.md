# Aevora Phase 1 — six legacy schedule disposition register

Date: 2026-10-14  
Branch: `aevora/release-scheduler-hardening`  
Status: **Evidence template only — no schedule is approved by this document.**

## Purpose

The read-only production inventory recorded six interval schedules attached to ongoing `ai_original` series, with `auto_generate=true`, `auto_publish=false`, `originality_status='pending'`, and no non-dry autonomous-creation run. The available evidence does not justify treating these rows as production-ready or choosing a disposition automatically.

This register prevents an aggregate finding from being mistaken for six individual decisions. Populate it only from a fresh, authorized, read-only inventory and explicit product-owner/editorial decisions. Do not infer schedule IDs, series IDs, owners, or approvals from row order.

## Required evidence for every row

For each schedule, capture: schedule UUID; series UUID and title (in access-controlled evidence, not a public report); current series status and origin; schedule mode/cadence/timezone; enabled/generation/publication flags; readiness marker; originality/safety/quality review state and timestamps; creation-run provenance; whether the series is a test fixture; owner/editor; and the exact evidence timestamp/query version. Redact story content, credentials, and unnecessary personal data.

A disposition is not complete until the decision maker, decision timestamp, reason, and evidence references are recorded. If any field is unknown or stale, choose **hold/manual-only** rather than guessing.

## Fresh inventory procedure

A branch-only, read-only query is available at [`scripts/aevora-legacy-schedule-disposition-inventory.sql`](../../scripts/aevora-legacy-schedule-disposition-inventory.sql). Run it only through an already-authorized read-only SQL session. It lists schedule and series IDs, title, current flags, readiness marker, cadence/timezone, and duplicate-schedule count for non-manual candidates (`ongoing`, `ai_original`, originality pending). Its output contains internal identifiers and titles: keep it in the approved access-controlled audit location, not a public report. It does not approve or mutate any schedule. Reconcile the fresh result to individual register rows; if candidate count or state differs from the prior six-row inventory, do not map by row order.

## Six-row review register

| Inventory slot | Schedule ID | Series ID | Evidence reviewed | Proposed disposition | Decision owner / timestamp | Approval evidence reference |
|---|---|---|---|---|---|---|
| Legacy row A | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |
| Legacy row B | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |
| Legacy row C | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |
| Legacy row D | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |
| Legacy row E | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |
| Legacy row F | Pending fresh inventory | Pending fresh inventory | Not reviewed | HOLD — no automation approval | Not recorded | None |

The A–F labels are template slots, **not a mapping to database row order**. Replace them with reviewed references only in an access-controlled decision record after a fresh inventory. Do not publish raw series identifiers in public operational reports.

## Allowed dispositions

1. **Manual-only (safe default):** keep `enabled=false`, `auto_generate=false`, `auto_publish=false`, and readiness NULL. Verify manual mode and the authorized manual workflow separately; clearing flags alone does not make an interval schedule manually usable.
2. **Reviewed scheduled generation only:** not available until a separate approval RPC/ledger is implemented and tested. It must bind approval to the exact series, schedule, configuration snapshot, trusted principal, reason, and current review evidence. It must keep `auto_publish=false`.
3. **Reviewed autonomous generation plus publication:** not available until both generation and publication approvals have separately defined trusted principals/evidence, implementation, revocation behavior, and adversarial/concurrency tests. Never infer publication approval from generation approval.

## Mandatory checks before a non-default disposition

- Confirm the row is not a test fixture, unless a separately documented test-only policy applies.
- Confirm exactly one schedule exists for the series and its cadence/timezone are intentional.
- Resolve originality, safety, and editorial review requirements; pending originality is not a pass.
- Confirm terminal/hiatus status and lifecycle transitions fail closed.
- Confirm configuration changes, expiration, revocation, or pause invalidate readiness.
- Confirm publication authorization is distinct from generation authorization.
- Preserve the existing schedule mode unless a reviewed mode conversion is explicitly approved and tested.
- Record the change plan and rollback behavior before any live mutation.

## Current gate

All six slots remain **HOLD / NOT APPROVED** in this register. This is a conservative planning disposition, not a claim that production rows were changed. The register does not authorize a migration, grant change, deployment, cron mutation, schedule update, generation, or publication. The overall Phase 1 production gate remains **NO-GO** until the approval principal/source is decided, the approval path is implemented and audited, Supabase-specific compatibility and rollback are rehearsed, and the per-series evidence is reviewed.
