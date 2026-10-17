-- Aevora Phase 1: atomically persist a quality review and its output transition.
-- Branch candidate only; not applied to production. Caller must use a trusted server role.
-- The function is SECURITY INVOKER and runs the output transition plus review upsert
-- in one PostgreSQL transaction. A failed review write rolls back the output update.
BEGIN;

CREATE OR REPLACE FUNCTION public.aevora_commit_quality_review(
  p_output_id uuid,
  p_review_status text,
  p_score numeric,
  p_findings jsonb,
  p_reviewer_model text,
  p_reviewer_version text,
  p_generation_status text,
  p_quality_report jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  changed_output_id uuid;
  review_id uuid;
BEGIN
  IF p_output_id IS NULL
     OR p_review_status NOT IN ('passed', 'needs_revision')
     OR p_generation_status NOT IN ('quality_check', 'needs_revision')
     OR (p_review_status = 'passed' AND p_generation_status <> 'quality_check')
     OR (p_review_status = 'needs_revision' AND p_generation_status <> 'needs_revision')
     OR p_findings IS NULL
     OR p_quality_report IS NULL
     OR p_reviewer_model IS NULL
     OR p_reviewer_version IS NULL
     OR p_score IS NULL
     OR p_score < 0
     OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid quality-review commit arguments'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.chapter_generation_outputs AS output
     SET generation_status = p_generation_status,
         quality_score = p_score,
         quality_report = p_quality_report,
         updated_at = pg_catalog.now()
   WHERE output.id = p_output_id
     AND output.generation_status IN ('generated', 'needs_revision', 'quality_check')
  RETURNING output.id INTO changed_output_id;

  IF changed_output_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'committed', false,
      'reason', 'output_state_changed'
    );
  END IF;

  INSERT INTO public.chapter_reviews (
    generation_output_id,
    review_type,
    status,
    score,
    findings,
    reviewer_model,
    reviewer_version
  ) VALUES (
    p_output_id,
    'quality',
    p_review_status,
    p_score,
    p_findings,
    p_reviewer_model,
    p_reviewer_version
  )
  ON CONFLICT (generation_output_id, review_type) DO UPDATE
    SET status = EXCLUDED.status,
        score = EXCLUDED.score,
        findings = EXCLUDED.findings,
        reviewer_model = EXCLUDED.reviewer_model,
        reviewer_version = EXCLUDED.reviewer_version,
        updated_at = pg_catalog.now()
  RETURNING id INTO review_id;

  RETURN pg_catalog.jsonb_build_object(
    'committed', true,
    'output_id', changed_output_id,
    'review_id', review_id,
    'generation_status', p_generation_status,
    'review_status', p_review_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aevora_commit_quality_review(
  uuid, text, numeric, jsonb, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aevora_commit_quality_review(
  uuid, text, numeric, jsonb, text, text, text, jsonb
) TO service_role;

COMMIT;
