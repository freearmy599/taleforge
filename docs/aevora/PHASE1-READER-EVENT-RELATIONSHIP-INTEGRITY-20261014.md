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
