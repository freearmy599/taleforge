\set ON_ERROR_STOP on
DO $assert$
DECLARE
  signature text;
  target regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.apply_attachment_directives(uuid)',
    'public.get_active_story_arc_plan(uuid)',
    'public.get_production_buffer_plan()',
    'public.get_story_narrative_destination(uuid)',
    'public.prepare_next_chapter_blueprint(uuid)',
    'public.refresh_story_attachment_metrics(uuid)',
    'public.taleforge_get_long_term_architecture_context(uuid)',
    'public.taleforge_score_story_opportunity(numeric,numeric,numeric,numeric,numeric)',
    'public.taleforge_update_updated_at()',
    'public.touch_story_lifecycle_updated_at()',
    'public.update_series_chapter_count()',
    'public.update_updated_at()'
  ]
  LOOP
    target := to_regprocedure(signature);
    IF target IS NULL THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: function fixture % is missing', signature;
    END IF;
    IF has_function_privilege('anon', target, 'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: anon retains EXECUTE on %', signature;
    END IF;
    IF has_function_privilege('authenticated', target, 'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: authenticated retains EXECUTE on %', signature;
    END IF;
    IF NOT has_function_privilege('service_role', target, 'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost EXECUTE on %', signature;
    END IF;
  END LOOP;
END
$assert$;

-- Exercise the trigger under anon after direct EXECUTE on its trigger function
-- has been revoked. The trigger sets touched=true, proving it actually ran.
SET ROLE anon;
INSERT INTO public.aevora_rpc_acl_trigger_source(id, touched) VALUES (1, false);
UPDATE public.aevora_rpc_acl_trigger_source SET id = 2 WHERE id = 1;
RESET ROLE;

DO $trigger_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.aevora_rpc_acl_trigger_source
    WHERE id = 2 AND touched = true
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: trigger function stopped working after client EXECUTE revocation';
  END IF;
END
$trigger_assert$;
SELECT 'internal RPC EXECUTE and trigger assertions passed' AS result;
