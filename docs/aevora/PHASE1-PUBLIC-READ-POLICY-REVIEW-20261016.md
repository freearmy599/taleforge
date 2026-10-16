# Aevora Phase 1 — public SELECT policy review for narrative intelligence
Date: 2026-10-16
Branch: aevora/release-scheduler-hardening
Environment: read-only catalog inspection of connected Supabase project

## Finding

A read-only query of the 41 relations targeted by `20261014180000_revoke_unapproved_internal_client_writes.sql` found that all 41 have RLS enabled, exactly one SELECT policy each, and no write policies. Their relation-level client grants still include SELECT/INSERT/UPDATE/DELETE/TRUNCATE, but RLS policies are SELECT-only. This supports revoking unused write and maintenance grants while preserving the existing SELECT surface.

The same query revealed a separate question: **27 of those 41 SELECT policies are attached to story planning, story-concept, character/arc/world architecture, narrative memory, or story-opportunity tables.** Their predicates permit rows in statuses such as `candidate`, `validated`, `approved`, `designed`, `active`, or `verified`. These may be legitimate public reference records, but several appear to be internal generation/planning artifacts rather than reader-facing catalog data. A status named “validated” or “approved” does not itself prove public disclosure was intended.

No read policy was removed and no data was queried beyond schema/catalog metadata.

## Candidate public reference data — retain only after product approval (14)

These tables look most plausibly like public reference/taxonomy data. The current policies filter rows by active/validated status:

- `taleforge_genre_grammars`
- `taleforge_genre_inversion_patterns`
- `taleforge_genre_taxonomy`
- `taleforge_grammar_compatibility`
- `taleforge_hybrid_story_recipes`
- `taleforge_hybrid_story_recipes_generated`
- `taleforge_narrative_culture_profiles`
- `taleforge_narrative_modes`
- `taleforge_series_genre_grammar_profiles`
- `taleforge_series_genre_profiles`
- `taleforge_series_narrative_profiles`
- `taleforge_series_subgenre_profiles`
- `taleforge_story_trope_library`
- `taleforge_subgenre_intelligence`

This is a naming-based provisional classification, not approval. Check whether generated recipe/profile records contain proprietary prompts, internal weights, or unpublished story strategies before retaining public read access.

## High-priority public-read review — story planning/intelligence (27)

The current live SELECT policies allow public/anon/authenticated reads for these relations:

| Table | Current predicate shape | Concern to resolve |
|---|---|---|
| `taleforge_advanced_chapter_plans` | designed; content_generated=false; canon_modified=false | A non-generated plan can still reveal future plot/chapter structure |
| `taleforge_character_architecture` | status=active | Active character design may be internal series bible material |
| `taleforge_ending_architecture` | status=active | Ending architecture can reveal planned story resolutions |
| `taleforge_narrative_arc_layers` | linked series is not draft/archived | Arc-layer planning data may reveal unreleased plot structure |
| `taleforge_narrative_memory_consolidations` | trust_status=verified | “Verified” memory may contain internal continuity facts |
| `taleforge_story_concept_arc_characters` | parent arc status planned/designed/validated | Exposes character-to-arc planning links |
| `taleforge_story_concept_arc_endings` | parent arc status planned/designed/validated | Exposes planned arc endings |
| `taleforge_story_concept_arc_relationships` | parent arc status planned/designed/validated | Exposes relationship planning |
| `taleforge_story_concept_arc_threads` | parent arc status planned/designed/validated | Exposes unresolved narrative threads |
| `taleforge_story_concept_arc_world_functions` | parent arc status planned/designed/validated | Exposes world/arc design dependencies |
| `taleforge_story_concept_arcs` | status planned/designed/validated | Public access to non-published story planning |
| `taleforge_story_concept_candidates` | status candidate/validated/approved | Potentially exposes unselected original concepts |
| `taleforge_story_concept_character_causality` | parent concept candidate/validated/approved | Exposes character causality and concept structure |
| `taleforge_story_concept_characters` | parent concept candidate/validated/approved | Exposes character architecture before publication |
| `taleforge_story_concept_evaluations` | decision strong_candidate/needs_design | Exposes internal selection/evaluation signals |
| `taleforge_story_concept_faction_causality` | parent concept candidate/validated/approved | Exposes faction causality |
| `taleforge_story_concept_factions` | parent world designed/validated/approved | Exposes faction design |
| `taleforge_story_concept_relationships` | status candidate/validated | Exposes concept relationship graph |
| `taleforge_story_concept_state_transitions` | parent world designed/validated/approved | Exposes world state changes |
| `taleforge_story_concept_world_dependencies` | parent world designed/validated/approved | Exposes world dependency graph |
| `taleforge_story_concept_world_links` | parent world designed/validated/approved | Exposes world-link architecture |
| `taleforge_story_concept_world_rules` | parent world designed/validated/approved | Exposes unpublished world rules |
| `taleforge_story_concept_world_state_models` | status designed/validated/approved | Exposes world simulation/state models |
| `taleforge_story_concept_world_state_transitions` | parent state model designed/validated/approved | Exposes simulation transitions |
| `taleforge_story_concept_worlds` | status designed/validated/approved | Exposes original world designs |
| `taleforge_story_opportunities` | status candidate/validated/approved | Exposes opportunity selection and possible future series ideas |
| `taleforge_story_specific_depth_designs` | designed; content_generated=false; canon_modified=false | A depth design can still reveal internal narrative strategy |

## Recommended disposition

1. Keep the existing 41-table write/maintenance revoke candidate separate; it preserves SELECT and addresses a distinct least-privilege issue.
2. Before any read-policy mutation, inspect the exact columns on the 27 candidate tables, the UI/API routes that read them, and the Edge Function call sites.
3. If these are internal creation-system artifacts, remove client SELECT policies and relation/column SELECT grants for the affected tables; keep trusted service-role worker access. Do not delete rows.
4. If some fields are intentionally reader-facing, expose a deliberately allowlisted public view/projection rather than the raw planning table. Review views for `security_invoker` behavior and sensitive columns.
5. Add disposable regression tests proving anonymous readers cannot fetch unpublished concepts/arc/world/ending designs while intended published catalog content remains available.
6. Keep this as a release gate: do not blindly revoke SELECT from all 27, because the product may intentionally expose a subset of curated taxonomy/strategy data.

## Safety and release status

This is a read-only policy inventory and branch-only design finding. No production policies, grants, data, migrations, Edge Functions, schedules, chapters, or publications were changed. Production automatic publishing remains NO-GO.


## Additional base story-planning surfaces — 2026-10-16

The base tables `story_arc_plan`, `story_ending_plans`, and `story_lifecycle` are outside the 41-table `taleforge_*` review above and require separate treatment. Live catalog inspection shows public SELECT policies on all three. Their columns include final conflict/resolution, ending requirements, planned ending chapter, target buffer sizes, and lifecycle review state. Browser source inspection found no direct browser reads; trusted Edge Functions use server-side clients for arc planning and lifecycle coordination.

The live `series_status_check` excludes the value `published`, even though the SELECT policies on `story_arc_plan` and `story_ending_plans` test for exactly that value. Those policies and `get_active_story_arc_plan(uuid)` therefore appear inconsistent with the current status model. The `story_lifecycle` policy instead checks only `published_at IS NOT NULL`, potentially exposing internal lifecycle/ending fields for series that were previously published.

Branch-only candidate `20261016220000_lock_base_story_planning_read_surfaces.sql` removes client relation/column privileges and client/public policies while preserving trusted server access. Its disposable rehearsal passed in [CI run 38946455150](https://github.com/freearmy599/taleforge/actions/runs/38946455150). No live ACL, policy, or data change was made.
