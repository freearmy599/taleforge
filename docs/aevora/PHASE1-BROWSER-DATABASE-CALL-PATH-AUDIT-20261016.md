# Aevora Phase 1 — Browser Database Call-Path Audit (2026-10-16)

Status: source-only review on `aevora/release-scheduler-hardening`; no production requests, database mutations, deployments, migrations, schedule changes, generation, or publication performed.

## Scope and method

Reviewed the current browser sources `supabase-client.js`, `taleforge-data.js`, `reading-progress.js`, `index.html`, `stories.html`, `series.html`, `chapter.html`, and `notifications.html`. This identifies explicit repository call sites and graceful-degradation behavior. It does not prove deployed HTML matches the branch, PostgREST schema exposure, or actual live request outcomes.

## Confirmed browser-facing call paths

| Relation / endpoint | Browser caller | Operation | User-visible dependency / note |
|---|---|---|---|
| `series` | `taleforge-data.js:getPublishedSeries` | SELECT published/ongoing or completed series; reads public metadata | Critical: homepage, Explore, and series pages depend on it. A fallback SELECT omits the genres join if the first query fails. |
| `chapters` | `taleforge-data.js:getPublishedSeries`, `getPublishedChapters`; `index.html`; `notifications.html` | SELECT published chapter metadata/content, ordered by publication/chapter time | Critical: chapter lists, reading content, chapter counts, updates, and rising-story calculations. The source filters to `status = 'published'`; live policy and grants still require compatibility validation. |
| `story_intelligence` | `taleforge-data.js:getPublishedSeries` | SELECT limited enrichment fields by series IDs | Optional enrichment: errors are not thrown or displayed; missing data silently removes intelligence badges/ranking inputs. |
| `story_trending_scores` | `stories.html:loadTrending` | SELECT score and engagement aggregate fields | Optional Explore shelf: query errors are caught and replaced with “Trending is warming up.” |
| `reader_events` | `reading-progress.js:track` | INSERT visitor event by default | Browser writes are enabled by default because `window.taleForgeReaderEventIntakeEnabled = false` in `supabase-client.js`. The alternative `reader-event-intake` Edge Function path is conditional on changing this flag. No service-role key is present in browser source. |
| Browser-local storage | `reading-progress.js` | Stores follows, bookmarks, reading history/progress and visitor ID locally | These functions do not require database tables or an account; this is intentional current behavior, not server-synced account state. |

## Security and compatibility implications

1. **Preserve published reader access.** Do not revoke client access to `series` or `chapters` as if they were server-only tables. Verify their published-content RLS predicates and exact minimum SELECT grants against these callers.
2. **Trending and intelligence are non-critical enrichment.** The current UI intentionally tolerates missing `story_intelligence` and `story_trending_scores`. A migration that gates these views can reduce discovery features without breaking core reading. That trade-off should be explicit in the rollout notes and acceptance tests.
3. **Reader-event intake is still direct from the browser.** The current code writes to `reader_events` with the public/publishable key unless the feature flag is enabled. Before enabling the Edge Function path, verify deployed endpoint availability, request validation, duplicate/idempotency semantics, rate limits, and CORS. Do not expose service-role credentials. Do not add public SELECT on raw events to fix aggregate views.
4. **Local follows/bookmarks are not database policies.** `followSeries`, `unfollowSeries`, `bookmarkChapter`, and reading history operate on local storage. Do not add policies to unrelated `follows`, `bookmarks`, or `reading_history` tables merely because these UI concepts exist; inventory their other callers first.
5. **Notifications are currently public published-chapter discovery plus local follows.** The feed reads published chapter rows for locally followed series and a recent public feed. It does not query a private notifications table.
6. **Public configuration is not a secret.** `supabase-client.js` contains the project URL and publishable key, and explicitly avoids a service-role key. Authorization must be enforced by database grants/RLS and trusted server endpoints, not by hiding this key.

## Branch migration compatibility notes

- The prepared trending aggregate migration gates client access to `story_trending_scores` and `story_intelligence` until trusted event intake/abuse controls are ready. Source call sites show this is a deliberate reduced-feature mode, with graceful fallbacks; it must not be described as preserving public trending.
- The `reader_events` browser insert path remains active in current branch source. A future migration that revokes this insert must be paired with enabling and verifying the trusted intake endpoint, or event capture will stop.
- The server-only table migration list must be based on actual call paths and the live relation inventory. Names alone are not enough to classify tables.
- The `taleforge_ai_provider_state`, `release_schedules`, and publication outbox/control tables do not appear in the reviewed reader-page call paths. This is evidence from these selected files only, not proof no other browser/admin/operations caller exists.

## Required follow-up before rollout

- Confirm deployed frontend commit/source matches the reviewed branch.
- Reconcile exact live SELECT/INSERT grants and RLS policies for `series`, `chapters`, and `reader_events` with these call sites.
- Decide whether public trending is intentionally disabled until trusted event intake is enabled; test both the disabled and enabled states.
- Inventory all admin/Chief Editor/creator pages and scripts before finalizing the server-only table matrix.
- Verify Edge Function runtime behavior and rollback plan in an approved non-production rehearsal.
- Keep production changes gated on explicit authorization.

## Evidence reviewed

- `supabase-client.js` — public project configuration; reader-event intake flag defaults to `false`.
- `taleforge-data.js` — published series/chapter SELECTs and optional intelligence enrichment.
- `reading-progress.js` — browser-local library and direct `reader_events` INSERT path.
- `index.html`, `stories.html`, `series.html`, `chapter.html`, `notifications.html` — homepage/discovery/reading/update callers.


## Additional privileged admin-page call-path review

A follow-up review covered `admin.html`, `chief-editor.html`, and the selected scheduler/publisher/series-runner source files.

- `admin.html` invokes `chief-editor-monitor`, `autonomous-series-creation` with `mode: "preflight", dry_run: true`, and `aevora-operations-snapshot`.
- `chief-editor.html` invokes `chief-editor-monitor`.
- Both pages first call Supabase Auth `getUser()` and check the signed-in user's `app_metadata.role` for `admin` or `owner`. This is a browser-side UI gate, not by itself proof that the corresponding Edge Functions independently enforce the role on every request.
- These three invoked function implementations are not present in the reviewed branch tree. Prior deployed-drift inventory notes them as production-only functions requiring source fingerprinting and reconciliation. Their live authorization behavior, side effects, and compatibility cannot be established from these HTML callers.
- The selected branch scheduler calls the publisher endpoint and directly references `release_schedules`, `story_lifecycle`, `chapters`, `chapter_generation_outputs`, and `chapter_publication_reviews`. The publisher references the outbox, reviews, series, schedules, blueprints and chapters. The autonomous series runner references its policy/run tables, series, lifecycle and schedules. These are server-side call paths and must retain intended trusted-role grants while client roles are narrowed.
- The reviewed admin page preflight caller requests `dry_run: true`, but do not infer from the request payload alone that the deployed implementation has no side effects; validate the deployed function and its durable postconditions before treating it as a safe rehearsal.

### Required admin/operations follow-up

1. Obtain authoritative source/deployment fingerprints for `chief-editor-monitor`, `autonomous-series-creation`, and `aevora-operations-snapshot`; compare their authentication, role authorization, allowed operations and side effects with the current HTML.
2. Verify privileged functions validate JWT identity and the required server-side role/authorization on the server, independently of the UI's `app_metadata.role` check. Do not infer a vulnerability or safety from the missing branch source alone.
3. Trace the exact trusted role and grants used by scheduler, publisher and autonomous series runner before applying client grant revocations.
4. Keep the publication stop and do not invoke production admin actions as part of this source-only audit.
