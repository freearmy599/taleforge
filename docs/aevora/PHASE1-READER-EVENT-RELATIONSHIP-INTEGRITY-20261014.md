# Phase 1 reader-event integrity checkpoint — 2026-10-14

## Verified live finding

The live INSERT policy on `public.reader_events` validates that any supplied series is ongoing/completed and that any supplied chapter is published. It does not validate that the chapter belongs to the supplied series. If both IDs are supplied, a caller can attempt to create a semantically inconsistent event unless another constraint or trigger prevents it.

The branch-only migration `20261014150000_reader_events_insert_only.sql` limits ordinary clients to INSERT at the table-privilege layer and retains row-level validation, but INSERT-only permissions do not establish event authenticity and do not prevent replay or high-volume spam.

## Required branch-only repair

Prepare a separate migration that recreates the existing INSERT policy while requiring:
- if `chapter_id` is supplied, `series_id` must also be supplied;
- the referenced chapter must match both supplied IDs (`chapters.id = chapter_id` and `chapters.series_id = series_id`);
- the referenced chapter must be published;
- any supplied series must remain ongoing/completed.

Do not deploy or apply this proposal until migration compatibility review and authorization.

## Required regression tests

1. Ongoing/completed series + published chapter from that same series: accepted.
2. Published chapter paired with a different series: rejected.
3. Chapter ID supplied without series ID: rejected.
4. Draft/unpublished chapter: rejected.
5. Draft/archived series: rejected.
6. Series-only event with an eligible series: accepted.
7. Anonymous/authenticated roles cannot SELECT, UPDATE, DELETE, TRUNCATE, or create triggers on raw reader events after the intended least-privilege migration.
8. Confirm service-role intake and existing reader flows remain compatible.

## Remaining abuse controls

The visitor identifier is client supplied and length checks do not prove uniqueness or authenticity. Trending remains vulnerable to replay/fabricated events unless intake adds deduplication, rate controls, and/or trusted server-side validation. These are separate from the relationship-integrity fix.

## Production safety

This is an audit checkpoint only. No production DDL, migrations, function deployments, schedule changes, chapter generation, or publication were performed.


## Exact live policy and effective privilege recheck (read-only, 2026-10-14)

A fresh catalog query confirmed the relationship gap and a more urgent table-level privilege drift:

- RLS is enabled on `public.reader_events`, but FORCE RLS is false; owner is `postgres`.
- The live policy `Public can record reader events` is INSERT-only at the policy-command level. It checks visitor ID length, an eligible supplied series, and a published supplied chapter—but it does not compare `chapters.series_id` with `reader_events.series_id`, nor require a series when a chapter is supplied.
- The foreign keys only validate that each ID independently exists. They do not enforce the chapter/series pair relationship.
- Despite the INSERT-only policy, effective table privileges currently report **SELECT, INSERT, and UPDATE = true** for both `anon` and `authenticated`. The policy has no SELECT/UPDATE policy, so RLS ordinarily denies those row operations; however, the grants are broader than intended and leave unnecessary privilege (and table-level UPDATE does not become safe just because a policy currently blocks row access).
- Both `public.reader_events_id_seq` and `public.aevora_engineering_events_id_seq` currently report `USAGE` for `anon` and `authenticated`. The branch-only sequence cleanup is not live.
- The branch-only `20261014150000_reader_events_insert_only.sql` and `20261014120000_lock_public_identity_sequence_grants.sql` are therefore relevant, but their absence from the migration ledger is not permission to apply them. Test identity inserts and sequence behavior in an isolated environment first.

**Priority update:** the live raw-event access model is not yet at the intended least-privilege state. Keep the aggregate RPC gated on the relationship repair, table/column ACL cleanup, sequence ACL cleanup, anti-replay/spam controls, and role-based regression tests. No production grants, policies, sequences, or data were changed by this check.
