-- Aevora Phase 1 revision-successor conflict report
-- READ ONLY: use this when the revision-idempotency migration preflight aborts.
-- Lists IDs, statuses, and timestamps only; it deliberately does not select
-- generated chapter text or any other story content. A human editor must compare
-- the approved successors in the authorized editor before choosing a winner.

WITH duplicate_approved_parents AS (
  SELECT revision_of_output_id
  FROM public.chapter_generation_outputs
  WHERE revision_of_output_id IS NOT NULL
    AND generation_status = 'approved'
  GROUP BY revision_of_output_id
  HAVING count(*) > 1
)
SELECT
  output.revision_of_output_id AS parent_output_id,
  output.id AS successor_output_id,
  output.generation_status,
  output.created_at,
  output.updated_at
FROM public.chapter_generation_outputs AS output
JOIN duplicate_approved_parents AS duplicate
  ON duplicate.revision_of_output_id = output.revision_of_output_id
ORDER BY output.revision_of_output_id, output.created_at DESC NULLS LAST, output.id DESC;
