# Aevora Phase 1 — Production Drift Audit
Date: 2026-10-12
Scope: Read-only production inspection; prepared repair branch only.

## Executive result

**Do not deploy the prepared scheduler/publisher replacement yet.** The repair branch has a successful hosted validation run, but the deployed functions are materially older than the prepared code. Branch CI proves the branch's source contracts; it does not prove production has those protections.

- Repository: `freearmy599/taleforge`
- Prepared branch: `aevora/release-scheduler-hardening`
- Latest validated branch commit: `b2ee3de7a6d9f5b9e3506241b5b06266255add36`
- Latest hosted CI run: [38274956230](https://github.com/freearmy599/taleforge/actions/runs/38274956230) — scheduler/publisher type-check and source-contract regression tests passed.
- Production Edge Functions remain unchanged during this audit.
- No migrations, schedule changes, chapter publishing, secret access/rotation, billable branches, or deployment were performed.

## Follow-up source hardening on 2026-10-12

- Published chapter history parsing now accepts only integer numbers or plain decimal digit strings before safe-integer/range validation. This prevents JavaScript coercions such as `true`, `[1]`, hexadecimal strings, exponent strings, and decimal-form strings from being interpreted as plausible chapter numbers.
- Regression coverage was added for those malformed input classes while retaining plain decimal-string compatibility.
- Hosted validation run [38274956230](https://github.com/freearmy599/taleforge/actions/runs/38274956230) completed successfully on commit `b2ee3de7a6d9f5b9e3506241b5b06266255add36`.
- This is prepared-branch-only source hardening. Production remains unchanged; no database writes, migration applications, schedule changes, chapter generation/publication, secret changes, or deployments were performed.

## Confirmed live/prepared source mismatch

Production metadata reports `release-scheduler` version 12 and `release-publisher` version 21. Reading the actual deployed function source shows older internal source markers (`release-scheduler-v5-contiguous-approved-release` and `release-publisher-v5-outbox`), while the prepared branch contains the hardened scheduler and publisher handlers.

The live scheduler source does not contain the prepared branch's internal API-key check, lease claim/renew/release flow, publication-review qualification before selecting outputs, full published-history gap guard, cooldown recovery guard, strict publisher response confirmation, or database confirmation that a returned chapter is published. The live publisher source does not contain the prepared branch's internal API-key check, generation-status eligibility guard, or exact existing-chapter identity/status guard.

This is source divergence, not proof of a currently exploitable endpoint: both deployed functions report `verify_jwt=true`, and the cron authentication path still needs a controlled, explicitly authorized end-to-end verification before any deployment decision.

## Read-only production data findings

- Six enabled release schedules were observed; all six have `auto_publish=false`. Do not change them as part of repair preparation.
- One schedule for **The House That Grows Rooms** has a stale `next_release_at` of 2026-10-06 and no `last_release_at`; investigate its generation/lifecycle state before considering any schedule mutation.
- Current published chapter numbering gaps:
  - **The Clockwork Sky:** chapters 10, 16, and 18 are missing while later chapters are published.
  - **The Last Unsent Letter:** chapter 3 is missing while later chapters are published.
  - **After the Red Eclipse:** chapters 3, 10, and 11 are missing while later chapters are published.
- A read-only query found six generation outputs marked `approved` with no publication-review row. These must remain ineligible for automatic publication until they receive a real review with all four gates explicitly true.
- The database currently reports 62 rows with `status='published'` across the whole chapters table; this is a count of published chapter rows, not a claim that all series are contiguous.
- Supabase security advisors currently report 91 tables with RLS enabled but no policies. Some may be intentionally service-only; triage by table access requirements before making any policy changes. Do not apply blanket policies.

## Safe next sequence

1. Keep the repair branch isolated and preserve the passing CI run.
2. Complete source-level review of scheduler, publisher, and shared internal API-key validation.
3. Verify cron-to-Edge authentication in a controlled way without exposing or rotating secret values and without weakening `verify_jwt`.
4. Add/complete a non-mutating integration verification path for review gates, leases, stale schedule handling, publication confirmation, and chapter gaps.
5. Re-audit the three published-history gaps and six reviewless approved outputs; do not auto-publish or fabricate missing chapters to make counts contiguous.
6. Only after explicit deployment authorization, deploy in a controlled sequence and verify live source/version and safe dry-run behavior. Do not enable `auto_publish` as part of that deployment.

## Stop conditions

Stop and report rather than making a production change if verification requires reading secret values, changing JWT verification, modifying cron credentials, creating a billable Supabase branch, changing release schedules, publishing chapters, applying schema changes, or merging to the default branch.
