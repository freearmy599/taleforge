-- Enforce at most one direct revision successor for each generation output.
-- This migration preserves history: duplicate non-winning successors are marked
-- rejected rather than deleted. It aborts if a source has multiple published
-- successors, because choosing between published outputs requires manual review.
DO $$
BEGIN
  IF to_regclass('public.chapter_generation_outputs') IS NULL THEN
    RAISE EXCEPTION 'chapter_generation_outputs is required for revision idempotency';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.chapter_generation_outputs
    WHERE revision_of_output_id IS NOT NULL
      AND generation_status = 'published'
    GROUP BY revision_of_output_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple published revision successors exist; reconcile them manually before applying the unique index';
  END IF;
END
$$;

WITH ranked_successors AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY revision_of_output_id
      ORDER BY
        CASE generation_status
          WHEN 'published' THEN 0
          WHEN 'approved' THEN 1
          WHEN 'quality_check' THEN 2
          WHEN 'generated' THEN 3
          WHEN 'needs_revision' THEN 4
          WHEN 'rejected' THEN 5
          ELSE 6
        END,
        created_at DESC NULLS LAST,
        id DESC
    ) AS successor_rank
  FROM public.chapter_generation_outputs
  WHERE revision_of_output_id IS NOT NULL
)
UPDATE public.chapter_generation_outputs AS output
SET generation_status = 'rejected',
    updated_at = now()
FROM ranked_successors AS ranked
WHERE output.id = ranked.id
  AND ranked.successor_rank > 1
  AND output.generation_status <> 'published';

CREATE UNIQUE INDEX IF NOT EXISTS chapter_generation_outputs_revision_successor_unique
  ON public.chapter_generation_outputs (revision_of_output_id)
  WHERE revision_of_output_id IS NOT NULL;
