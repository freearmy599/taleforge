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
- Verification query confirmed RLS enabled, anonymous/authenticated SELECT denied, and service-role SELECT allowed.
- Read-only inspection found no existing Supabase Storage buckets at the time of inspection.

## Cover lifecycle (target)
1. **Brief:** derive a cover brief from the approved series title, genre, premise, setting, mood, and distinct visual motifs.
2. **Generate:** call a configured image-generation provider from a trusted server-side function. Never put provider API keys in browser code.
3. **Store:** upload the candidate to a private or intentionally public Supabase Storage bucket using a deliberate access policy; save the approved image URL in the existing series `cover_image` field.
4. **Review:** validate image dimensions, file type, size, content safety, and series relevance. Allow an authorized editor to approve, regenerate, or replace.
5. **Display:** use the same cover URL on Home, Explore, series detail, library, and recommendations. Use the designed placeholder whenever no valid image exists.
6. **Monitor:** record generation failures and missing/broken covers without blocking chapter generation or publication.

## Approval and cost safeguards
- Do not generate covers from public-page requests or on every page load.
- Deduplicate queue jobs by series/version to avoid duplicate provider charges.
- Use an image provider only after its endpoint, credentials, free-tier/price, and output license are confirmed.
- A failed cover job must not block series creation, chapter generation, review, or scheduled release.
- Do not overwrite an approved cover automatically. Regeneration creates a candidate for review.
- Keep provider credentials server-side; no secret keys in HTML, GitHub commits, client JavaScript, queue payloads, or public logs.
- Do not create a Storage bucket or make it public until the storage access model is explicitly chosen.

## Current limitations
The design branch implements the presentation and missing-image fallback. The production database now has the secure queue foundation, but no Edge Function yet claims jobs, calls an image provider, uploads candidate assets, or runs editorial approval. No provider has been configured, and no Storage bucket exists yet. Chapter generation and publication were not triggered or changed by this cover work.

## Acceptance checks
- [ ] Home shows a readable placeholder for a series with no cover URL.
- [ ] Explore shows the same visual language for a missing cover.
- [ ] A valid `cover_image` displays above the placeholder.
- [ ] A broken URL falls back cleanly.
- [ ] Cover images preserve a portrait 2:3 ratio and use `object-fit: cover`.
- [ ] Cover text and alt text remain accessible.
- [ ] No provider secret appears in client code.
- [ ] Cover jobs are cost-controlled, deduplicated, reviewable, and independent from chapter publishing.
- [ ] Worker uses bounded retries and marks failures without blocking story operations.
