-- Aevora Phase 1 publication-boundary schema provenance inventory.
-- READ ONLY: run only through an already-authorized read-only SQL session.
-- Do not paste credentials into chat or commit production row data. Catalog metadata only.
-- Inspect taleforge_internal as well as aevora_private: live catalog review found
-- taleforge_internal, while aevora_private was absent. Keep both names visible until
-- migration/source provenance establishes the intended private-schema name.

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind,
  c.relpersistence,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS row_level_security_enabled,
  c.relforcerowsecurity AS row_level_security_forced,
  c.relacl AS relation_acl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, c.relname;

-- Schema ownership and effective ACLs matter for SECURITY DEFINER routines:
-- untrusted CREATE rights can enable object-shadowing risks in writable schemas.
SELECT
  n.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) AS owner_name,
  n.nspacl AS schema_acl,
  acl.grantee,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_namespace n
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) acl
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
ORDER BY n.nspname, grantee_name, acl.privilege_type;

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  a.attidentity AS identity_kind,
  a.attgenerated AS generated_kind,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
  pg_catalog.col_description(c.oid, a.attnum) AS column_comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum;

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS is_validated,
  con.condeferrable AS is_deferrable,
  con.condeferred AS initially_deferred,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, c.relname, con.conname;

SELECT
  n.nspname AS schema_name,
  t.relname AS relation_name,
  i.relname AS index_name,
  ix.indisprimary AS is_primary,
  ix.indisunique AS is_unique,
  ix.indisexclusion AS is_exclusion,
  ix.indisvalid AS is_valid,
  ix.indisready AS is_ready,
  pg_catalog.pg_get_indexdef(i.oid) AS definition,
  pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) AS partial_predicate
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND t.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, t.relname, i.relname;

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  t.tgisinternal AS is_internal,
  pg_catalog.pg_get_userbyid(p.proowner) AS trigger_function_owner,
  p.prosecdef AS trigger_function_security_definer,
  p.proconfig AS trigger_function_settings,
  pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, c.relname, t.tgname;

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  acl.grantee,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault(
    CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'r' END::pg_catalog."char",
    c.relowner
  ))
) acl
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, c.relname, grantee_name, acl.privilege_type;

SELECT
  CASE WHEN d.defaclnamespace = 0 THEN '<global>' ELSE n.nspname END AS schema_name,
  pg_catalog.pg_get_userbyid(d.defaclrole) AS default_acl_owner,
  d.defaclobjtype AS object_type,
  acl.grantee,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
WHERE d.defaclnamespace = 0 OR n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
ORDER BY schema_name, default_acl_owner, d.defaclobjtype, grantee_name, acl.privilege_type;

SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS routine_settings,
  p.proacl AS routine_acl,
  pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE') AS current_user_can_execute,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  pg_catalog.pg_get_functiondef(p.oid) AS routine_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND (
    p.proname = 'taleforge_ceo_execution_gate'
    OR p.proname ILIKE '%publication%'
    OR p.proname ILIKE '%release%lease%'
    OR p.proname ILIKE '%advance_release_schedule%'
    OR p.proname ILIKE '%activate_story_lifecycle%'
    OR p.proname ILIKE '%sync%outbox%'
    OR p.proname ILIKE '%reader_event%'
    OR p.proname ILIKE '%provider%cooldown%'
  )
ORDER BY n.nspname, p.proname, identity_arguments;

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  pol.polname AS policy_name,
  pol.polcmd AS command,
  pol.polpermissive AS permissive,
  pol.polroles AS role_oids,
  pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
  pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expression
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'aevora_private', 'taleforge_internal')
  AND c.relname IN (
    'release_schedules',
    'series',
    'chapter_generation_outputs',
    'chapter_blueprints',
    'story_blueprints',
    'chapter_reviews',
    'chapter_publication_reviews',
    'aevora_release_scheduler_leases',
    'chapters',
    'taleforge_autonomous_series_creation_runs',
    'publication_sync_outbox',
    'reader_events',
    'reader_event_quota_buckets',
    'reader_event_quota_cleanup_state'
  )
ORDER BY n.nspname, c.relname, pol.polname;

-- No application rows are selected. Reconcile this metadata with tracked
-- migrations before choosing RPC argument types or commit-boundary predicates.


-- Governance gate dependency provenance and relation ACL/policy review.
-- Read-only catalog metadata. These names were found live but not in the
-- inspected tracked migrations; keep provenance unresolved until authoritative
-- migration/source artifacts are recovered.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  acl.grantee,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
) acl
WHERE n.nspname = 'public'
  AND c.relname IN (
    'taleforge_system_governance_registry',
    'taleforge_system_governance_dependencies',
    'taleforge_system_governance_runs',
    'taleforge_system_health'
  )
ORDER BY c.relname, grantee_name, acl.privilege_type;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'taleforge_system_governance_registry',
    'taleforge_system_governance_dependencies',
    'taleforge_system_governance_runs',
    'taleforge_system_health'
  )
ORDER BY tablename, policyname;

-- Retrieve exact live definitions for the two publication/governance gate
-- functions. Function text can contain implementation details; do not export
-- secrets or application row data.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  p.proacl AS function_acl,
  pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'taleforge_ceo_execution_gate',
    'taleforge_boss_evaluate'
  )
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- Group schema-scoped default ACLs by creator role and object type so
-- duplicated acl rows do not obscure the separate postgres/supabase_admin
-- default entries. This is inspection only; never apply a blanket revoke from
-- this query without an authorized owner path and a disposable rehearsal.
SELECT
  pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role,
  n.nspname AS schema_name,
  CASE d.defaclobjtype
    WHEN 'r' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'f' THEN 'FUNCTION'
    WHEN 'T' THEN 'TYPE'
    ELSE d.defaclobjtype::text
  END AS object_type,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
  string_agg(DISTINCT acl.privilege_type, ', ' ORDER BY acl.privilege_type) AS privileges,
  bool_or(acl.is_grantable) AS any_grantable
FROM pg_catalog.pg_default_acl d
JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
WHERE n.nspname = 'public'
  AND pg_catalog.pg_get_userbyid(d.defaclrole) IN ('postgres', 'supabase_admin')
  AND acl.grantee IN (
    0,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon'),
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
  )
GROUP BY d.defaclrole, n.nspname, d.defaclobjtype, acl.grantee
ORDER BY creator_role, object_type, grantee_name;


-- Governance lineage comparison: relation identity, columns, constraints,
-- foreign-key targets, and catalog dependency edges. Metadata only; no rows.
WITH target_names(name) AS (
  VALUES
    ('taleforge_system_registry'),
    ('taleforge_system_governance_registry'),
    ('taleforge_system_dependencies'),
    ('taleforge_system_governance_dependencies'),
    ('taleforge_system_health'),
    ('taleforge_system_governance_runs')
)
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.oid AS relation_oid,
  c.relkind AS relation_kind,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (SELECT name FROM target_names)
ORDER BY c.relname;

WITH target_names(name) AS (
  VALUES
    ('taleforge_system_registry'),
    ('taleforge_system_governance_registry'),
    ('taleforge_system_dependencies'),
    ('taleforge_system_governance_dependencies'),
    ('taleforge_system_health'),
    ('taleforge_system_governance_runs')
)
SELECT
  c.relname AS relation_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d
  ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname IN (SELECT name FROM target_names)
ORDER BY c.relname, a.attnum;

WITH target_names(name) AS (
  VALUES
    ('taleforge_system_registry'),
    ('taleforge_system_governance_registry'),
    ('taleforge_system_dependencies'),
    ('taleforge_system_governance_dependencies'),
    ('taleforge_system_health'),
    ('taleforge_system_governance_runs')
)
SELECT
  c.relname AS relation_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS constraint_definition,
  referenced.relname AS referenced_relation
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_class referenced ON referenced.oid = con.confrelid
WHERE n.nspname = 'public'
  AND c.relname IN (SELECT name FROM target_names)
ORDER BY c.relname, con.conname;

WITH target_names(name) AS (
  VALUES
    ('taleforge_system_registry'),
    ('taleforge_system_governance_registry'),
    ('taleforge_system_dependencies'),
    ('taleforge_system_governance_dependencies'),
    ('taleforge_system_health'),
    ('taleforge_system_governance_runs')
)
SELECT
  dependent_ns.nspname AS dependent_schema,
  dependent.relname AS dependent_relation,
  dependent.relkind AS dependent_kind,
  referenced_ns.nspname AS referenced_schema,
  referenced.relname AS referenced_relation,
  dependency.deptype AS dependency_type
FROM pg_catalog.pg_depend dependency
JOIN pg_catalog.pg_class referenced ON referenced.oid = dependency.refobjid
JOIN pg_catalog.pg_namespace referenced_ns ON referenced_ns.oid = referenced.relnamespace
JOIN pg_catalog.pg_class dependent ON dependent.oid = dependency.objid
JOIN pg_catalog.pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
WHERE referenced_ns.nspname = 'public'
  AND referenced.relname IN (SELECT name FROM target_names)
  AND dependent_ns.nspname = 'public'
ORDER BY dependent.relname, referenced.relname;

WITH target_names(name) AS (
  VALUES
    ('taleforge_system_registry'),
    ('taleforge_system_governance_registry'),
    ('taleforge_system_dependencies'),
    ('taleforge_system_governance_dependencies'),
    ('taleforge_system_health'),
    ('taleforge_system_governance_runs')
)
SELECT
  c.relname AS relation_name,
  trg.tgname AS trigger_name,
  trg.tgenabled AS enabled_state,
  pg_catalog.pg_get_triggerdef(trg.oid, true) AS trigger_definition,
  trigger_ns.nspname || '.' || trigger_fn.proname AS trigger_function
FROM pg_catalog.pg_trigger trg
JOIN pg_catalog.pg_class c ON c.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc trigger_fn ON trigger_fn.oid = trg.tgfoid
JOIN pg_catalog.pg_namespace trigger_ns ON trigger_ns.oid = trigger_fn.pronamespace
WHERE n.nspname = 'public'
  AND c.relname IN (SELECT name FROM target_names)
  AND NOT trg.tgisinternal
ORDER BY c.relname, trg.tgname;


-- Governance routine source-body inventory and effective EXECUTE matrix.
-- Catalog metadata only; this does not execute routines or read app rows.
SELECT
  p.oid AS routine_oid,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prokind AS routine_kind,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))::text AS explicit_or_default_acl,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  length(p.prosrc) AS source_characters,
  left(regexp_replace(p.prosrc, E'[\\n\\r\\t]+', ' ', 'g'), 500) AS source_preview
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND (
    p.proname IN (
      'taleforge_boss_evaluate',
      'taleforge_ceo_execution_gate',
      'taleforge_ceo_analyze_root_cause',
      'taleforge_ceo_build_repair_plan',
      'taleforge_ceo_run_diagnostic',
      'taleforge_observe_all_systems',
      'aevora_audit_registry_consistency',
      'aevora_diagnose_issue_evidence'
    )
    OR p.prosrc ILIKE '%taleforge_system_governance_registry%'
    OR p.prosrc ILIKE '%taleforge_system_governance_dependencies%'
    OR p.prosrc ILIKE '%taleforge_system_governance_runs%'
    OR p.prosrc ILIKE '%taleforge_boss_evaluate%'
    OR p.prosrc ILIKE '%taleforge_ceo_execution_gate%'
  )
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);


-- Broad SECURITY DEFINER search_path review candidate inventory.
-- This is metadata-only; it does not invoke routines or create temporary objects.
SELECT
  p.oid AS routine_oid,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prokind AS routine_kind,
  p.proconfig AS function_settings,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  pg_catalog.has_database_privilege('service_role', current_database(), 'TEMP') AS service_role_can_create_temp_objects,
  pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE') AS service_role_can_create_in_public,
  CASE
    WHEN p.proconfig @> ARRAY['search_path=public'] THEN 'public_only_temp_implicit_first'
    WHEN p.proconfig @> ARRAY['search_path=public, pg_temp'] THEN 'public_then_temp'
    ELSE 'other_public_inclusive_path'
  END AS path_review_bucket,
  length(p.prosrc) AS source_characters
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND EXISTS (
    SELECT 1
    FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
    WHERE setting ILIKE 'search_path=public%'
       OR setting ILIKE 'search_path=%public%'
  )
ORDER BY path_review_bucket, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);


-- First-pass seed scan for unqualified references to common Aevora relations.
-- Text search only; manually inspect complete definitions before classifying risk.
SELECT
  p.oid AS routine_oid,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.proconfig AS function_settings,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  CASE
    WHEN p.prosrc ILIKE '% from series %' OR p.prosrc ILIKE '% join series %'
      OR p.prosrc ILIKE '% update series %' THEN 'series'
    WHEN p.prosrc ILIKE '% from chapters %' OR p.prosrc ILIKE '% join chapters %'
      OR p.prosrc ILIKE '% update chapters %' THEN 'chapters'
    WHEN p.prosrc ILIKE '% from taleforge_system_health %'
      OR p.prosrc ILIKE '% from taleforge_system_registry %'
      OR p.prosrc ILIKE '% from taleforge_system_governance_registry %'
      OR p.prosrc ILIKE '% from taleforge_system_governance_dependencies %'
      OR p.prosrc ILIKE '% from taleforge_system_governance_runs %' THEN 'governance_or_health'
    ELSE 'other_seeded_relation'
  END AS matched_relation_family,
  length(p.prosrc) AS source_characters,
  left(regexp_replace(p.prosrc, E'[\\n\\r\\t]+', ' ', 'g'), 900) AS source_preview
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.proconfig @> ARRAY['search_path=public']
  AND (
    p.prosrc ILIKE '% from series %' OR p.prosrc ILIKE '% join series %'
    OR p.prosrc ILIKE '% update series %'
    OR p.prosrc ILIKE '% from chapters %' OR p.prosrc ILIKE '% join chapters %'
    OR p.prosrc ILIKE '% update chapters %'
    OR p.prosrc ILIKE '% from taleforge_system_health %'
    OR p.prosrc ILIKE '% from taleforge_system_registry %'
    OR p.prosrc ILIKE '% from taleforge_system_governance_registry %'
    OR p.prosrc ILIKE '% from taleforge_system_governance_dependencies %'
    OR p.prosrc ILIKE '% from taleforge_system_governance_runs %'
  )
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);


-- Caller/trigger map for the first-pass SECURITY DEFINER candidates.
-- Catalog metadata and routine source text only; no function is invoked.
WITH targets AS (
  SELECT p.oid, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'taleforge_reassess_long_term_narrative_architecture',
      'taleforge_refresh_long_term_narrative_architecture',
      'taleforge_verify_narrative_memory_consolidation'
    )
)
SELECT
  t.proname AS target_routine,
  t.identity_arguments AS target_arguments,
  coalesce((
    SELECT string_agg(c.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(c.oid) || ')', '; ' ORDER BY c.proname)
    FROM pg_catalog.pg_proc c
    JOIN pg_catalog.pg_namespace cn ON cn.oid = c.pronamespace
    WHERE cn.nspname = 'public'
      AND c.oid <> t.oid
      AND c.prosrc ILIKE '%' || t.proname || '(%'
  ), '(no direct source-text caller found)') AS routine_source_callers,
  coalesce((
    SELECT string_agg(
      tn.nspname || '.' || tc.relname || ':' || tr.tgname || ' => ' || tp.proname,
      '; ' ORDER BY tc.relname, tr.tgname
    )
    FROM pg_catalog.pg_trigger tr
    JOIN pg_catalog.pg_class tc ON tc.oid = tr.tgrelid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_catalog.pg_proc tp ON tp.oid = tr.tgfoid
    WHERE NOT tr.tgisinternal
      AND tn.nspname = 'public'
      AND (tp.proname = t.proname OR tp.prosrc ILIKE '%' || t.proname || '(%')
  ), '(no matching non-internal trigger found)') AS matching_triggers
FROM targets t
ORDER BY t.proname, t.identity_arguments;
