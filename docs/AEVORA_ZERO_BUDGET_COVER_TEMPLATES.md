# Aevora Zero-Budget Cover Templates

## Purpose
Give every series a deliberate, genre-aware cover presentation while Aevora has no image-generation budget. This is a local CSS design system, not generated image art: it makes no provider calls, uses no external image assets, consumes no Gemini quota, and adds no paid dependency.

## Explore implementation
- Explore cards select a deterministic visual theme from the series genre: fantasy, science fiction, mystery/thriller, romance/drama, horror/dark fiction, adventure/action, or the default Aevora midnight-blue palette.
- Each theme combines a distinct color atmosphere with geometric light/ring motifs.
- The title and genre remain the cover's primary text; existing cover images continue to render above the fallback.
- If a real cover URL is missing or fails, the template remains visible.
- Unknown or mixed genres fall back safely to the default theme.

## Safety and cost rules
- Never call an image provider during page rendering.
- Do not use external image URLs as a substitute for generated or licensed art.
- Do not let cover processing block series creation, chapter generation, editorial review, or scheduled publication.
- When a provider is eventually connected, candidates must stay private until validation and explicit editorial approval.
- Keep provider credentials server-side; never place keys in frontend files or GitHub.

## Next steps
1. Apply the same genre theme mapping to the series detail cover.
2. Add optional series-specific motifs derived from approved metadata (without sending data to an external service).
3. When revenue allows, evaluate OpenAI image generation and other providers against cost, quality, rate limits, and usage terms before enabling one.
4. Keep an admin spending cap and one-job-at-a-time processing before any paid provider is activated.

## Current limitations
These are CSS-based cover designs, not standalone illustrations. Explore cards and the series detail cover now share the same deterministic genre theme mapping on the feature/aevora-design-system-v1 branch. No image API is configured, no provider request was made, and no cover was generated or published.
