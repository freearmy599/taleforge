# Aevora Phase 1 — candidate client privilege matrix
Date: 2026-10-16
Branch: `aevora/release-scheduler-hardening`
Status: **Proposal for review; not an approved production ACL change**

## Purpose

Translate the read-only live catalog findings into a narrow, testable intended-access model. This file is a design artifact only. It does not authorize production DDL, grants/revokes, migrations, deployments, schedule changes, generation, or publication.

## Live evidence motivating this proposal

The live catalog has RLS enabled on the 12 inspected publication-boundary relations. Among them, the current policies are:
- `chapters`: public SELECT limited to published chapters and eligible series.
- `series`: public SELECT limited to ongoing/completed series.
- `reader_events`: constrained INSERT for reader analytics.
- No policies on the other inspected workflow relations.

Despite that, `anon` and `authenticated` currently have table-level SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER on ten relations: `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `publication_sync_outbox`, `release_schedules`, `story_blueprints`, `chapters`, `series`, and `reader_events`. RLS does not constrain `TRUNCATE`. The lease table and autonomous-series-run table did not show those ordinary-role table grants in the focused inventory.

## Candidate least-privilege matrix

This is the intended target to validate against all browser call paths before preparing a migration. `service_role` access is not changed by this proposal and must be independently reviewed against server-side use.

| Relation | anon | authenticated | Rationale / validation required |
|---|---|---|---|
| `public.chapters` | SELECT only | SELECT only | Preserve existing published-chapter read policy; remove unrelated write, truncate, reference, and trigger privileges after checking views/RPC dependencies |
| `public.series` | SELECT only | SELECT only | Preserve existing published-series read policy; remove unrelated write, truncate, reference, and trigger privileges after checking views/RPC dependencies |
| `public.reader_events` | INSERT only | INSERT only | Preserve constrained reader-event intake; remove direct SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER unless a verified caller requires otherwise |
| `public.chapter_blueprints` | none | none | Internal planning and generation state; no client policy exists |
| `public.story_blueprints` | none | none | Internal series canon/planning state; no client policy exists |
| `public.chapter_generation_outputs` | none | none | Internal generated content and worker state; no client policy exists |
| `public.chapter_reviews` | none | none | Internal review decisions; no client policy exists |
| `public.chapter_publication_reviews` | none | none | Internal publication gate; no client policy exists |
| `public.publication_sync_outbox` | none | none | Internal delivery queue; no client policy exists |
| `public.release_schedules` | none | none | Internal scheduling controls; no client policy exists |
| `public.aevora_release_scheduler_leases` | none | none | Internal lease/fencing state; observed ordinary table grants absent |
| `public.taleforge_autonomous_series_creation_runs` | none | none | Internal autonomous-creation run state; observed ordinary table grants absent |

“None” means no direct table/sequence/column grants to ordinary client roles. Any future reader or creator feature that needs access should use a separately designed, narrowly scoped, authorization-checked interface rather than direct access to workflow tables.

## Mandatory validation before turning this proposal into a migration

1. **Call-path inventory:** search the current frontend, server routes, views, RPCs, and edge functions for direct references to every listed relation. Distinguish browser-role calls from server-role calls. Do not infer no usage merely from a search returning no matches; document search coverage and aliases.
2. **Dependency inventory:** inspect views, triggers, trigger functions, SECURITY DEFINER functions, foreign keys, and grants on dependent objects. Preserve existing published reads and reader-event intake.
3. **Privilege tests:** in disposable PostgreSQL, assert `anon` and `authenticated` have exactly the intended effective privileges, including table, column, sequence, and routine ACLs. Explicitly test that ordinary roles cannot TRUNCATE workflow tables.
4. **RLS tests:** assert the published-chapter and published-series SELECT policies still expose only intended rows, and reader-event INSERT remains constrained.
5. **Server-role compatibility:** assert service-role workers still have the minimum permissions needed for generation, review, scheduling, outbox processing, and publication. Do not broadly alter service-role access as a side effect.
6. **Migration provenance:** reconcile live migration history and the current migration directory before adding a migration. The original provider-state migration discrepancy remains a separate blocker; do not fabricate migration history.
7. **Rollback and approval:** produce an explicit rollback plan and require owner approval before any production ACL change.

## Open schema discrepancies

- Live schema includes `taleforge_internal`; `aevora_private` was not found. The read-only publication inventory now checks both names until provenance establishes the intended canonical name.
- `reader_event_quota_buckets` and `reader_event_quota_cleanup_state` were not found in the live catalog. Reconcile migrations and deployed callers before changing code or creating these objects.
- The database contains lease RPCs with server-only EXECUTE ACLs, but the deployed scheduler v12 was previously observed not to call them. RPC existence is not proof of lease enforcement.

## Decision

**Do not apply this matrix to production yet.** First complete the call-path/dependency inventory and rehearse the exact proposed grants in disposable PostgreSQL. Keep automated publication NO-GO until the separate publication-authorization transaction and scheduler/publisher integration gates are passed.
