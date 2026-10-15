-- Aevora Phase 1: read-only schema provenance inventory for Gemini provider state.
-- Run only through an already-authorized read-only SQL session.
-- This script performs catalog SELECTs only. It does not inspect row payloads,
-- change grants, invoke application RPCs, or mutate production state.
-- Capture results in the approved audit record; do not paste credentials.

-- 1. Relation identity, owner, RLS, and persistence kind.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.relkind,
       c.relpersistence,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       obj_description(c.oid, 'pg_class') AS table_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state';

-- 2. Exact column names, types, nullability, defaults, and column comments.
SELECT a.attnum AS ordinal_position,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expression,
       col_description(a.attrelid, a.attnum) AS column_comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state'
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;

-- 3. Constraints and their validated definitions.
SELECT con.conname AS constraint_name,
       con.contype AS constraint_type,
       con.convalidated AS validated,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state'
ORDER BY con.conname;

-- 4. Indexes and uniqueness details; needed to verify the provider conflict target.
SELECT i.indexrelid::regclass AS index_name,
       i.indisprimary AS is_primary,
       i.indisunique AS is_unique,
       i.indisvalid AS is_valid,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'taleforge_ai_provider_state'
ORDER BY i.indexrelid::regclass::text;

-- 5. Triggers and trigger functions. Definitions may contain internal logic;
-- retain them only in the approved audit location.
SELECT t.tgname AS trigger_name,
       t.tgenabled AS enabled_state,
       pg_get_triggerdef(t.oid, true) AS trigger_definition,
       p.oid::regprocedure AS trigger_function,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- 6. Effective table ACL entries, including grant options.
SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
       grantor.rolname AS grantor,
       x.privilege_type,
       x.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
LEFT JOIN pg_roles grantee ON grantee.oid = x.grantee
JOIN pg_roles grantor ON grantor.oid = x.grantor
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state'
ORDER BY grantee, x.privilege_type, grantor;

-- 7. Column-level ACL entries, which can survive relation-level REVOKE.
SELECT COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
       grantor.rolname AS grantor,
       a.attname AS column_name,
       x.privilege_type,
       x.is_grantable
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) x
LEFT JOIN pg_roles grantee ON grantee.oid = x.grantee
JOIN pg_roles grantor ON grantor.oid = x.grantor
WHERE n.nspname = 'public'
  AND c.relname = 'taleforge_ai_provider_state'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attacl IS NOT NULL
ORDER BY grantee, a.attname, x.privilege_type;

-- 8. Schema-level default table privileges for roles that can create public tables.
-- These affect future objects and must not be changed by this inventory.
SELECT owner_role.rolname AS default_acl_owner,
       n.nspname AS schema_name,
       COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
       x.privilege_type,
       x.is_grantable
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) x
LEFT JOIN pg_roles grantee ON grantee.oid = x.grantee
WHERE n.nspname = 'public'
  AND d.defaclobjtype = 'r'
ORDER BY owner_role.rolname, grantee, x.privilege_type;

-- 9. Existing routines whose names suggest provider-state or throttle handling.
-- This records signatures/ownership/security settings, not routine execution.
SELECT n.nspname AS schema_name,
       p.oid::regprocedure AS routine_signature,
       pg_get_userbyid(p.proowner) AS owner_name,
       p.prosecdef AS security_definer,
       p.proconfig AS routine_settings,
       p.proacl AS routine_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'extensions')
  AND (p.proname ILIKE '%provider%state%'
       OR p.proname ILIKE '%gemini%throttle%'
       OR p.proname ILIKE '%cooldown%')
ORDER BY n.nspname, p.proname, p.oid::regprocedure::text;
