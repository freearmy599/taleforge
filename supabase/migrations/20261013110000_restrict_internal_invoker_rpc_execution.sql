-- Internal planner and metrics RPCs are invoked by trusted Edge Functions only.
-- Remove inherited client EXECUTE grants without changing service_role access.
REVOKE EXECUTE ON FUNCTION public.apply_attachment_directives(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_story_arc_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_production_buffer_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_story_narrative_destination(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_next_chapter_blueprint(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_story_attachment_metrics(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.taleforge_get_long_term_architecture_context(uuid) FROM PUBLIC, anon, authenticated;

-- Pure scoring helper used by the trusted story-opportunity planner. It has no
-- trigger references and returns only a score/decision; it is not a client API.
REVOKE EXECUTE ON FUNCTION public.taleforge_score_story_opportunity(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- Trigger functions are not direct client APIs. Removing client EXECUTE grants
-- does not stop PostgreSQL from invoking them through their attached triggers.
REVOKE EXECUTE ON FUNCTION public.taleforge_update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_story_lifecycle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_series_chapter_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
