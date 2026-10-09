# Aevora Novel Cover System — v1 implementation plan

## Goal
Every public novel card and series page should have a deliberate, consistent cover presentation. Missing or broken cover art must never leave an empty rectangle or broken-image icon.

## Implemented in the design branch
- Home and Explore cards show a branded Aevora placeholder when `cover_image` is empty.
- The placeholder uses the series title and genre, with Aevora's midnight-blue/cyan art direction.
- When `cover_image` is present, the supplied image is shown above the placeholder.
- If the image fails to load, the image element is removed and the branded placeholder remains visible.
- Home navigation no longer advertises Manga or Anime while Aevora is launching as a novel platform.

## Backend foundation implemented
- Production Supabase migration `create_aevora_cover_job_queue` creates `public.aevora_cover_jobs`.
- Queue jobs are deduplicated by `series_id + series_version`, have bounded retry metadata, track candidate/review states, and store a structured cover brief.
- RLS is enabled. Direct table access is revoked from `anon` and `authenticated`; only `service_role` receives table privileges.
- Verification confirmed RLS enabled and direct SELECT denied to anonymous/authenticated roles.
- A private Supabase Storage bucket named `aevora-covers` is configured for PNG/JPEG/WebP files, with a 10 MiB per-file limit.
- Edge Function `aevora-cover-worker` v1 is deployed with JWT verification enabled and admin/owner app-metadata role checks.
- The function is deliberately **readiness-only**: it reports queue depth and whether server-side provider configuration exists. It does not claim jobs, generate images, or consume provider quota.
- Edge Function `aevora-cover-request` v2 is deployed with JWT verification and trusted `user.app_metadata.role` admin/owner checks. It accepts a series UUID, builds a structured brief from the series and genre metadata, and inserts one queue entry per series/version. Existing entries are reused; concurrent duplicate requests do not overwrite a job's status.
- Cover requests reject a series that already has `cover_image`, so this endpoint cannot automatically replace an assigned cover. The endpoint only queues a brief; it does not call an image provider or publish a candidate.
- The design-branch `admin.html` now has a **Request a Novel Cover** panel. An authorized admin enters a series UUID and calls the request endpoint through the signed-in Supabase client; no service-role key is exposed in the page.

## Cover lifecycle (target)
1. **Brief:** derive a cover brief from the approved series title, genre, premise, setting, mood, and distinct visual motifs.
2. **Generate:** call a configured image-generation provider from a trusted server-side function. Never put provider API keys in browser code.
3. **Store:** upload the candidate to the private `aevora-covers` bucket using the service role; only publish a deliberate public/authorized URL after approval.
4. **Review:** validate image dimensions, file type, size, content safety, and series relevance. Allow an authorized editor to approve, regenerate, or replace.
5. **Display:** use the same cover URL on Home, Explore, series detail, library, and recommendations. Use the designed placeholder whenever no valid image exists.
6. **Monitor:** record generation failures and missing/broken covers without blocking chapter generation or publication.

## Approval and cost safeguards
- Do not generate covers from public-page requests or on every page load.
- Deduplicate queue jobs by series/version to avoid duplicate provider charges.
- Configure `AEVORA_IMAGE_API_URL`, `AEVORA_IMAGE_API_KEY`, and `AEVORA_IMAGE_MODEL` as server-side Edge Function secrets only after choosing and validating a compatible provider adapter.
- The readiness function checks whether these values exist but does not print them.
- A failed cover job must not block series creation, chapter generation, review, or scheduled release.
- Do not overwrite an approved cover automatically. Regeneration creates a candidate for review.
- Keep provider credentials server-side; no secret keys in HTML, GitHub commits, client JavaScript, queue payloads, or public logs.

## Current limitations
The frontend fallback, private bucket, queue table, readiness-only worker, and admin-only cover-request endpoint are implemented. Image generation is **not enabled**: no provider adapter/secrets have been configured, the function does not claim jobs, and editorial approval/final cover assignment is not wired. The private bucket means cover URLs cannot yet be assumed publicly accessible. Chapter generation and publication were not triggered or changed by this cover work.

## Acceptance checks
- [ ] Home shows a readable placeholder for a series with no cover URL.
- [ ] Explore shows the same visual language for a missing cover.
- [ ] A valid `cover_image` displays above the placeholder.
- [ ] A broken URL falls back cleanly.
- [ ] Cover images preserve a portrait 2:3 ratio and use `object-fit: cover`.
- [ ] Cover text and alt text remain accessible.
- [x] No provider secret appears in client code; none has been configured.
- [x] Queue jobs are deduplicated and server-only.
- [x] Admin-only request endpoint creates a metadata-based brief and deduplicates by series/version.
- [x] Admin page exposes the guarded request action without exposing privileged keys.
- [ ] Provider adapter, bounded worker processing, review workflow, and final cover assignment.
