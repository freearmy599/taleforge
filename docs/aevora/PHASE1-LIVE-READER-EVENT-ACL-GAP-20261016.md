# Aevora Phase 1 — live reader-event ACL and relationship gap
**Audit date:** 2026-10-16  
**Environment:** read-only inspection of live Supabase project `sxmbnlgufqhcwxcpcsvb`  
**Status:** evidence only; no production mutation or deployment performed

## Confirmed live state

The live `public.reader_events` table has RLS enabled, but RLS is not forced. Its only policy is `Public can record reader events`, an INSERT policy for `anon` and `authenticated`.

The policy validates:
- a non-null visitor ID with length 16–100;
- if `series_id` is supplied, that series is in `ongoing` or `completed` status;
- if `chapter_id` is supplied, that chapter is published.

**Gap:** the live policy does not require the referenced chapter to belong to the supplied `series_id`. A valid published chapter from one series can therefore be paired with a different eligible series ID in an event.

The live table also has relation-level grants for both `anon` and `authenticated`:
- INSERT: granted
- SELECT: granted at ACL level, but no SELECT RLS policy was found, so ordinary row reads are blocked by RLS
- TRUNCATE: granted at ACL level; TRUNCATE is not governed by row-level policies and is therefore a serious least-privilege exposure

The live table does **not** yet have the `event_uuid` column. The current live schema contains `id`, `visitor_id`, `event_type`, `series_id`, `chapter_id`, `progress_percent`, and `created_at`.

## Branch candidate coverage

The branch contains the following candidate protections, none of which were applied to production during this audit:
- `20261014150000_reader_events_insert_only.sql`: revoke broad table privileges from `PUBLIC`, `anon`, and `authenticated`, then grant only INSERT to the client roles.
- `20261014200000_reader_event_relationship_integrity.sql`: require the chapter to be published **and** to belong to the supplied series.
- `20261014220000_reader_event_idempotency_key.sql`: add the optional `event_uuid` idempotency column and unique partial index.
- `20261015120000_reader_event_intake_rpc.sql`: add the server-side intake boundary and quota accounting; browser cutover remains opt-in.
- `20261016200000_revoke_client_table_maintenance_privileges.sql`: broader public-schema maintenance-privilege cleanup, including TRUNCATE.

The browser tracker was corrected on the branch so it includes `event_uuid` only when the intake endpoint is explicitly enabled. This preserves compatibility with the current live table while the intake flag remains false. When intake is enabled, endpoint failure does not fall back to direct table INSERT.

## Verification

The latest branch CI run available during this review, [38944051225](https://github.com/freearmy599/taleforge/actions/runs/38944051225), passed both:
- Edge Function type-checking/source-contract validation
- disposable PostgreSQL readiness/security rehearsal

These results validate branch candidates in the CI environment; they do not establish that the live project has received them.

## Release gate

Keep the reader-event intake cutover disabled until the candidate migrations are reviewed, rehearsed together in migration order, applied only with explicit authorization, and verified live. Before any production release, verify:
1. client ACLs are INSERT-only for this table;
2. no client role can TRUNCATE it;
3. the INSERT relationship check enforces chapter/series consistency;
4. idempotency schema and intake RPC are present before enabling browser cutover;
5. quotas and duplicate handling remain correct under concurrent mixed direct/RPC writers;
6. no service credential is exposed to the browser.

**No production schema, ACL, Edge Function, or client configuration was changed by this audit.**
