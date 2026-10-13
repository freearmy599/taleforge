-- Internal planner and metrics RPCs are invoked by trusted Edge Functions only.
-- Remove inherited client EXECUTE grants without changing service_role access.
REVOKE EXECUTE ON FUNCTION public.apply_attachment_directives(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_story_arc_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_production_buffer_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_story_narrative_destination(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_next_chapter_blueprint(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_story_attachment_metrics(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.taleforge_get_long_term_architecture_context(uuid) FROM PUBLIC, anon, authenticated;
