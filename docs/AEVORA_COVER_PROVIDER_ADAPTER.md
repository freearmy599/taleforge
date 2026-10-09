# Aevora Cover Generation Provider Decision — v1

## Decision

Use Cloudflare Workers AI as the first provider adapter candidate, behind a server-side interface. Do not enable generation until an administrator has configured credentials and reviewed the model's current price, output format, rate limits, and acceptable-use terms.

Why this is the first candidate:
- Aevora already uses Cloudflare Pages for the design preview.
- Workers AI publishes a daily free allocation and model-specific usage pricing; this may suit a low-volume cover queue better than spending the existing Gemini quota used by chapter generation.
- The provider remains replaceable: cover jobs are provider-neutral and store the prompt brief separately from provider output.

Official references (check before enabling because pricing and model availability can change):
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cloudflare Workers AI REST API: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- Cloudflare AI model catalog: https://developers.cloudflare.com/workers-ai/models/

## Cost and quota safeguards

- Never assume an image request is free just because a provider offers a free allocation.
- Confirm the selected image model's usage cost and the account's current allowance before enabling it.
- Process at most one cover job per worker invocation.
- Keep a per-job attempt cap and a bounded image byte limit (the current private bucket cap is 10 MiB).
- Never call the image provider from a public page load.
- Do not reuse or spend Gemini chapter-generation quota for cover art.
- If credentials are missing, return a configuration/readiness response without claiming jobs.
- If the provider is rate-limited or fails, mark only that cover job failed/retryable; never block story creation, chapter generation, editorial review, or publication.

## Secret configuration (not yet configured)

Store credentials only as Supabase Edge Function secrets. Do not put them in GitHub, HTML, queue rows, or client-side code.

Expected configuration for the Cloudflare adapter:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (minimum permissions required for Workers AI inference only)
- `AEVORA_IMAGE_MODEL` (must be an exact model identifier verified in the account's current catalog)

The adapter should construct prompts from the saved `cover_brief`, request one image, accept only a documented image response format, validate file signature and byte size, and upload the candidate to private `aevora-covers` storage under a server-generated path such as `candidates/<job-id>/candidate.webp`. Never trust a provider-supplied storage path.

## Required stages before production use

1. Implement the provider adapter and bounded claim/processing logic.
2. Validate provider response content type, magic bytes, byte size, and image dimensions before upload.
3. Record the provider/model and safe error codes, but never log credentials or raw binary.
4. Keep candidates private and mark a job `candidate_ready` only after upload and validation succeed.
5. Add editor approval that verifies a candidate exists, revalidates it, and copies it into a separate public approved-covers bucket or otherwise creates stable public delivery.
6. Assign `series.cover_image` only after explicit approval. Never auto-publish a candidate.
7. Test with one non-production series and a strict spend limit before enabling any scheduled cover worker.

## Current state

This is a provider decision and implementation contract only. No Cloudflare credentials have been configured, no image has been generated, no provider request has been made, and the deployed `aevora-cover-worker` remains readiness-only. The review endpoint intentionally cannot approve or publish covers yet.
