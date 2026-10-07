-- TaleForge concept arc dependency architecture
-- Documents live deployment of concept-level thread, world/faction and ending dependency maps.
comment on table public.taleforge_story_concept_arc_threads is 'Concept arc to narrative-thread dependency map.';
comment on table public.taleforge_story_concept_arc_world_functions is 'Concept arc to world/faction function map.';
comment on table public.taleforge_story_concept_arc_endings is 'Concept arc to ending dependency map.';
comment on function public.taleforge_build_arc_dependency_maps(uuid) is 'Builds concept-level dependency maps without prose generation or canon mutation.';