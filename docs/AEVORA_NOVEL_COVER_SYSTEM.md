# Aevora Novel Cover System — v1 implementation plan

## Goal
Every public novel card and series page should have a deliberate, consistent cover presentation. Missing or broken cover art must never leave an empty rectangle or broken-image icon.

## Implemented in the design branch
- Home and Explore cards show a branded Aevora placeholder when `cover_image` is empty.
- The placeholder uses the series title and genre, with Aevora's midnight-blue/cyan art direction.
- When `cover_image` is present, the supplied image is shown above the placeholder.
- If the image fails to load, the image element is removed and the branded placeholder remains visible.
- Home navigation no longer advertises Manga or Anime while Aevora is launching as a novel platform.

## Cover lifecycle (target)
1. **Brief:** derive a cover brief from the approved series title, genre, premise, setting, mood, and distinct visual motifs.
2. **Generate:** call a configured image-generation provider from a trusted server-side function. Never put provider API keys in browser code.
3. **Store:** upload the approved image to Supabase Storage (or another configured image store) and save its public/authorized URL in the existing series `cover_image` field.
4. **Review:** validate image dimensions, file type, size, content safety, and series relevance. Allow an authorized editor to approve, regenerate, or replace.
5. **Display:** use the same cover URL on Home, Explore, series detail, library, and recommendations. Use the designed placeholder whenever no valid image exists.
6. **Monitor:** record generation failures and missing/broken covers without blocking chapter generation or publication.

## Approval and cost safeguards
- Do not generate covers from public-page requests or on every page load.
- Queue cover jobs and deduplicate by series/version so retries do not create duplicate provider charges.
- Use an image provider only after its endpoint, credentials, free-tier/price, and output license are confirmed.
- A failed cover job must not block series creation, chapter generation, review, or scheduled release.
- Do not overwrite an approved cover automatically. Regeneration creates a candidate for review.
- Keep provider credentials server-side; no secret keys in HTML, GitHub commits, client JavaScript, or public logs.

## Current limitations
The branch currently implements the presentation and missing-image fallback. It does **not** yet call an image-generation provider, upload generated assets, or run a cover-job queue. Those require provider selection/configuration and inspection of the existing Supabase Storage and series schema before backend changes. No production database or publishing logic is changed by this frontend work.

## Acceptance checks
- [ ] Home shows a readable placeholder for a series with no cover URL.
- [ ] Explore shows the same visual language for a missing cover.
- [ ] A valid `cover_image` displays above the placeholder.
- [ ] A broken URL falls back cleanly.
- [ ] Cover images preserve a portrait 2:3 ratio and use `object-fit: cover`.
- [ ] Cover text and alt text remain accessible.
- [ ] No provider secret appears in client code.
- [ ] Generated-cover jobs are cost-controlled, deduplicated, reviewable, and independent from chapter publishing.
