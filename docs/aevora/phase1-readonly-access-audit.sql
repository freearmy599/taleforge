-- Aevora Phase 1 access-surface audit
-- READ ONLY: catalog/information_schema SELECTs only. No row contents, writes,
-- function invocations, grants, policies, schedules, or queue state are changed.
-- Run in the Supabase SQL editor with a role permitted to inspect catalog metadata.

-- 1) Public-schema base tables/views with grants to PUBLIC or client roles.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind WHEN 'r' THEN 'table'
                 WHEN 'p' THEN 'partitioned_table'
                 WHEN 'v' THEN 'view'
                 WHEN 'm' THEN 'materialized_view'
                 ELSE c.relkind::text END AS relation_kind,
  CASE WHEN c.relkind IN ('r', 'p') THEN c.relrowsecurity ELSE NULL END AS rls_enabled,
  CASE WHEN c.relkind IN ('r', 'p') THEN c.relforcerowsecurity ELSE NULL END AS force_rls,
  count(DISTINCT p.policyname) AS policy_count,
  string_agg(DISTINCT g.grantee, ', ' ORDER BY g.grantee) AS client_grantees,
  string_agg(DISTINCT g.privilege_type, ', ' ORDER BY g.privilege_type) AS table_privileges
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
LEFT JOIN information_schema.table_privileges g
  ON g.table_schema = n.nspname
 AND g.table_name = c.relname
 AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
GROUP BY n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
HAVING count(DISTINCT g.grantee) > 0
ORDER BY relation_kind, relation_name;

-- 2) Aggregate explicit per-column ACLs from pg_attribute.attacl.
-- This deliberately does not use information_schema.column_privileges, which can
-- reflect effective relation-level privileges rather than independent column ACLs.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  pg_get_userbyid(acl.grantor) AS grantor,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
  acl.privilege_type,
  count(DISTINCT a.attnum) AS columns_with_explicit_acl
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attacl IS NOT NULL
  AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
GROUP BY n.nspname, c.relname, acl.grantor, acl.grantee, grantee.rolname, acl.privilege_type
ORDER BY table_name, grantee, acl.privilege_type;

-- 3) Schema-level default table ACLs for future objects in public.
-- A result here is a forward-looking grant template, not proof of current access.
SELECT
  n.nspname AS schema_name,
  pg_get_userbyid(d.defaclrole) AS default_acl_owner,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable,
  d.defaclobjtype AS object_type
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND d.defaclobjtype IN ('r', 'S', 'f')
  AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
ORDER BY object_type, default_acl_owner, grantee, acl.privilege_type;

-- 4) Public-schema invoker/definer function execute grants to ordinary client roles.
-- Review function names/signatures before any permission change; do not blindly revoke.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  r.rolname AS grantee,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS effective_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS client_roles(role_name)
JOIN pg_roles r ON r.rolname = client_roles.role_name
WHERE n.nspname = 'public'
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
ORDER BY p.proname, identity_arguments, r.rolname;

-- 5) Existing public-schema sequence ACLs. Identity sequences should not be
-- directly exposed to ordinary clients; distinguish these from future defaults.
SELECT
  n.nspname AS schema_name,
  c.relname AS sequence_name,
  pg_get_userbyid(c.relowner) AS sequence_owner,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
ORDER BY sequence_name, grantee, acl.privilege_type;

-- 6) Other schema-specific default ACLs for ordinary client roles.
-- These schemas may be managed by Supabase extensions; inventory only, do not
-- change their defaults without verifying exposure and platform ownership.
SELECT
  CASE WHEN d.defaclnamespace = 0 THEN '<global>' ELSE n.nspname END AS schema_name,
  pg_get_userbyid(d.defaclrole) AS default_acl_owner,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable,
  d.defaclobjtype AS object_type
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE (d.defaclnamespace = 0 OR n.nspname <> 'public')
  AND d.defaclobjtype IN ('r', 'S', 'f')
  AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
ORDER BY object_type, schema_name, default_acl_owner, grantee, acl.privilege_type;

-- 7) Report whether the current audit executor is a member of the roles that
-- own public-schema defaults. Membership is a preflight signal, not authorization
-- to change defaults; any repair still requires an approved owner-scoped operation.
SELECT
  current_user AS audit_executor,
  owner_role.rolname AS default_acl_owner,
  pg_has_role(current_user, owner_role.oid, 'MEMBER') AS executor_is_member_of_owner_role
FROM pg_roles owner_role
WHERE owner_role.rolname IN ('postgres', 'supabase_admin')
ORDER BY owner_role.rolname;
