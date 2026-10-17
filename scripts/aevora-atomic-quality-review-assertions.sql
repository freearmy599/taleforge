\set ON_ERROR_STOP on
DO $assert$
DECLARE result jsonb;
BEGIN
  result := public.aevora_commit_quality_review(
    '00000000-0000-0000-0000-000000000001','passed',92,
    '{"ai_review":{"decision":"passed"}}'::jsonb,'gemini-test','quality-v1',
    'quality_check','{"quality_version":"quality-v1"}'::jsonb
  );
  IF result->>'committed' <> 'true' OR result->>'generation_status' <> 'quality_check' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: successful review was not atomically committed: %', result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000001' AND review_type='quality' AND status='passed' AND score=92) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: review row missing after successful commit';
  END IF;
  IF (SELECT generation_status FROM public.chapter_generation_outputs WHERE id='00000000-0000-0000-0000-000000000001') <> 'quality_check' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: output status was not advanced';
  END IF;

  result := public.aevora_commit_quality_review(
    '00000000-0000-0000-0000-000000000002','passed',92,
    '{"ai_review":{"decision":"passed"}}'::jsonb,'gemini-test','quality-v1',
    'quality_check','{"quality_version":"quality-v1"}'::jsonb
  );
  IF result->>'committed' <> 'false' OR result->>'reason' <> 'output_state_changed' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: published output was not fenced: %', result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000002' AND review_type='quality') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: review was written for finalized output';
  END IF;

  BEGIN
    PERFORM public.aevora_commit_quality_review(
      '00000000-0000-0000-0000-000000000003','needs_revision',0,
      '{"hard_validation":{"passed":false}}'::jsonb,'gemini-test','force-write-failure',
      'needs_revision','{"quality_version":"quality-v1"}'::jsonb
    );
    RAISE EXCEPTION 'ASSERTION_FAILED: fixture failure trigger did not raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
  END;
  IF (SELECT generation_status FROM public.chapter_generation_outputs WHERE id='00000000-0000-0000-0000-000000000003') <> 'generated' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: failed review write did not roll back output status';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000003' AND review_type='quality') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: partial review row remained after failure';
  END IF;

  -- The unique output/type key must keep retries idempotent rather than creating duplicate reviews.
  result := public.aevora_commit_quality_review(
    '00000000-0000-0000-0000-000000000001','needs_revision',70,
    '{"retry":"second-attempt"}'::jsonb,'gemini-test','quality-v2',
    'needs_revision','{"quality_version":"quality-v2"}'::jsonb
  );
  IF result->>'committed' <> 'true' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: retry/upsert did not commit: %', result;
  END IF;
  IF (SELECT count(*) FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000001' AND review_type='quality') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000001' AND review_type='quality' AND status='needs_revision' AND score=70 AND reviewer_version='quality-v2') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: retry did not update the unique review row';
  END IF;

  BEGIN
    PERFORM public.aevora_commit_quality_review(
      '00000000-0000-0000-0000-000000000001',NULL,70,
      '{"invalid":true}'::jsonb,'gemini-test','quality-v2',
      'needs_revision','{"quality_version":"quality-v2"}'::jsonb
    );
    RAISE EXCEPTION 'ASSERTION_FAILED: null review status was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.aevora_commit_quality_review(
      '00000000-0000-0000-0000-000000000001','passed',101,
      '{"invalid":true}'::jsonb,'gemini-test','quality-v2',
      'quality_check','{"quality_version":"quality-v2"}'::jsonb
    );
    RAISE EXCEPTION 'ASSERTION_FAILED: out-of-range score was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  IF has_function_privilege('anon','public.aevora_commit_quality_review(uuid,text,numeric,jsonb,text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.aevora_commit_quality_review(uuid,text,numeric,jsonb,text,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: browser role retains RPC EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role','public.aevora_commit_quality_review(uuid,text,numeric,jsonb,text,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost RPC EXECUTE';
  END IF;
END
$assert$;
SELECT 'atomic quality-review commit assertions passed' AS result;
