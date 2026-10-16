\set ON_ERROR_STOP on
DO $assert$
DECLARE
  table_name text;
  client_role text;
  privilege_name text;
  target regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'automation_config',
    'chapter_blueprints',
    'chapter_generation_outputs',
    'chapter_publication_reviews',
    'chapter_reviews',
    'generation_jobs',
    'generation_settings',
    'release_schedules',
    'story_blueprints',
    'story_versions',
    'taleforge_ceo_daily_operations',
    'taleforge_ceo_incidents',
    'taleforge_ceo_repair_plans',
    'taleforge_continuity_extraction_queue',
    'taleforge_executive_reports',
    'taleforge_generation_context_snapshots',
    'taleforge_hybrid_story_engine_runs',
    'taleforge_inversion_evaluations',
    'taleforge_narrative_profile_selections',
    'taleforge_novelty_signatures',
    'taleforge_story_concept_design_runs',
    'taleforge_story_opportunity_runs',
    'taleforge_system_governance_dependencies',
    'taleforge_system_governance_registry',
    'taleforge_system_governance_runs'
  ]
  LOOP
    target := to_regclass(format('public.%I', table_name));
    IF target IS NULL THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: expected fixture table public.% is missing', table_name;
    END IF;

    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = target) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: RLS is not enabled on public.%', table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
      WHERE c.oid = target AND a.grantee = 0
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC retains an explicit/default table ACL on public.%', table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute att
      CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
      WHERE att.attrelid = target AND att.attnum > 0 AND NOT att.attisdropped
        AND a.grantee = 0
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC retains a column ACL on public.%', table_name;
    END IF;

    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
      LOOP
        IF has_table_privilege(client_role, target, privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on public.%', client_role, privilege_name, table_name;
        END IF;
      END LOOP;

      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES']
      LOOP
        IF has_column_privilege(client_role, target, 'id', privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: % retains column % on public.%(id)', client_role, privilege_name, table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT has_table_privilege('service_role', target, privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on public.%', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$assert$;
DO $maintenance$
DECLARE
  role_name text;
  privilege_name text;
BEGIN
  IF to_regclass('public.chapters') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: CRUD-preservation fixture public.chapters is missing';
  END IF;

  -- Client maintenance privileges must be gone, but ordinary CRUD must remain.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated']
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY['MAINTAIN','TRUNCATE','TRIGGER','REFERENCES']
    LOOP
      IF has_table_privilege(role_name, 'public.chapters', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains maintenance privilege % on public.chapters', role_name, privilege_name;
      END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT has_table_privilege(role_name, 'public.chapters', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: maintenance-only repair removed intended % privilege for % on public.chapters', privilege_name, role_name;
      END IF;
    END LOOP;

    IF has_column_privilege(role_name, 'public.chapters', 'id', 'REFERENCES') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: % retains column REFERENCES on public.chapters(id)', role_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.chapters'::regclass
      AND a.grantee = 0
      AND a.privilege_type IN ('MAINTAIN','TRUNCATE','TRIGGER','REFERENCES')
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC retains maintenance privilege on public.chapters';
  END IF;

  FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES']
  LOOP
    IF NOT has_table_privilege('service_role', 'public.chapters', privilege_name) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: trusted service_role lost % on public.chapters', privilege_name;
    END IF;
  END LOOP;
END
$maintenance$;
DO $future_defaults$
DECLARE
  table_name text;
  role_name text;
  privilege_name text;
  target regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['future_postgres_table','future_supabase_admin_table']
  LOOP
    target := to_regclass(format('public.%I', table_name));
    IF target IS NULL THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: future default ACL fixture % is missing', table_name;
    END IF;

    FOREACH role_name IN ARRAY ARRAY['anon','authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES']
      LOOP
        IF has_table_privilege(role_name, target, privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: future table % grants % to %', table_name, privilege_name, role_name;
        END IF;
      END LOOP;

      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
      LOOP
        IF NOT has_table_privilege(role_name, target, privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: future table % lost intended CRUD % for %', table_name, privilege_name, role_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES']
    LOOP
      IF NOT has_table_privilege('service_role', target, privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on future table %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$future_defaults$;
SELECT 'internal policyless table and column lock assertions passed for 25 relations' AS result;



-- Dormant account/community relations remain closed to ordinary API roles until
-- their corresponding auth-backed workflows and owner policies are implemented.
DO $dormant_assert$
DECLARE
  v_table_name text;
  v_client_role text;
  v_privilege text;
  v_target regclass;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'profiles',
    'bookmarks',
    'collections',
    'collection_stories',
    'comments',
    'likes',
    'notifications',
    'ratings',
    'reading_history',
    'story_reports',
    'recommendations',
    'story_arc_plan',
    'story_ending_plans',
    'story_lifecycle'
  ]
  LOOP
    v_target := to_regclass(format('public.%I', v_table_name));
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: dormant fixture table public.% is missing', v_table_name;
    END IF;

    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_target) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: RLS is not enabled on dormant table public.%', v_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = v_table_name
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: dormant table public.% unexpectedly has a policy', v_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
      WHERE c.oid = v_target AND a.grantee = 0
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC retains relation privileges on dormant table public.%', v_table_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute att
      CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
      WHERE att.attrelid = v_target AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = 0
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC retains column privileges on dormant table public.%', v_table_name;
    END IF;

    FOREACH v_client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
      LOOP
        IF has_table_privilege(v_client_role, v_target, v_privilege) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on dormant table public.%', v_client_role, v_privilege, v_table_name;
        END IF;
      END LOOP;

      FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES']
      LOOP
        IF has_column_privilege(v_client_role, v_target, 'id', v_privilege) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: % retains column % on dormant table public.%(id)', v_client_role, v_privilege, v_table_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT has_table_privilege('service_role', v_target, v_privilege) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on dormant table public.%', v_privilege, v_table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$dormant_assert$;
SELECT 'dormant account/community and story-planning ACL assertions passed for 14 relations' AS result;
