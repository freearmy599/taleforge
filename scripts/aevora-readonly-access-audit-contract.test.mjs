/**
 * Guard the reusable database access audit against accidental mutations.
 * Source-level contract only; the SQL is not executed by this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../docs/aevora/phase1-readonly-access-audit.sql", import.meta.url),
  "utf8",
);

const trendingMigration = await readFile(
  new URL("../supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql", import.meta.url),
  "utf8",
);

test("Phase 1 access audit contains only read-only SELECT statements", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "").trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 5, "expected five discrete metadata queries");
  for (const [index, statement] of statements.entries()) {
    assert.match(statement, /^SELECT\b/i, `statement ${index + 1} must begin with SELECT`);
    assert.doesNotMatch(
      statement,
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/i,
      `statement ${index + 1} must not contain a mutating SQL command`,
    );
  }
});

test("explicit column ACL audit uses pg_attribute.attacl rather than effective column privileges", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "");
  assert.match(executableSql, /pg_attribute\s+a/i);
  assert.match(executableSql, /aclexplode\(a\.attacl\)/i);
  assert.doesNotMatch(executableSql, /FROM\s+information_schema\.(role_)?column_privileges/i);
});

test("function inventory inspects effective EXECUTE without calling functions", () => {
  assert.match(sql, /has_function_privilege\(r\.rolname, p\.oid, 'EXECUTE'\)/i);
  assert.match(sql, /pg_get_function_identity_arguments\(p\.oid\)/i);
});

test("default ACL inventory distinguishes future-object privileges by owner", () => {
  assert.match(sql, /FROM\s+pg_default_acl\s+d/i);
  assert.match(sql, /pg_get_userbyid\(d\.defaclrole\)\s+AS\s+default_acl_owner/i);
  assert.match(sql, /d\.defaclobjtype/i);
  assert.match(sql, /aclexplode\(d\.defaclacl\)/i);
  assert.match(sql, /WHERE\s+n\.nspname\s*=\s*'public'/i);
});

test("existing sequence ACL inventory is read-only and distinguishes client roles", () => {
  assert.match(sql, /c\.relkind\s*=\s*'S'/i);
  assert.match(sql, /aclexplode\(c\.relacl\)/i);
  assert.match(sql, /sequence_owner/i);
  assert.match(sql, /grantee\.rolname\s+IN\s+\('anon',\s*'authenticated'\)/i);
});


test("public trending data is exposed only through a fixed-search-path aggregate function", () => {
  assert.match(trendingMigration, /CREATE OR REPLACE FUNCTION public\.get_public_story_trending_scores\(\)/i);
  assert.match(trendingMigration, /SECURITY DEFINER/i);
  assert.match(trendingMigration, /SET search_path = pg_catalog/i);
  assert.match(trendingMigration, /created_at > pg_catalog\.now\(\) - interval '30 days'/i);
  assert.match(trendingMigration, /WHERE s\.status = ANY \(ARRAY\['ongoing'::text, 'completed'::text\]\)/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.get_public_story_trending_scores\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT EXECUTE ON FUNCTION public\.get_public_story_trending_scores\(\) TO anon, authenticated, service_role/i);
  assert.match(trendingMigration, /CREATE OR REPLACE VIEW public\.story_trending_scores\s+WITH \(security_invoker = true\)/i);
  assert.doesNotMatch(trendingMigration, /visitor_id|reader_events\.id|CREATE\s+POLICY|GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events/i);
});


const identitySequenceMigration = await readFile(
  new URL("../supabase/migrations/20261014120000_lock_public_identity_sequence_grants.sql", import.meta.url),
  "utf8",
);

test("identity sequence migration limits direct sequence access without changing identity columns", () => {
  for (const sequence of ["aevora_engineering_events_id_seq", "reader_events_id_seq"]) {
    assert.match(
      identitySequenceMigration,
      new RegExp("REVOKE ALL PRIVILEGES ON SEQUENCE public\\." + sequence + " FROM PUBLIC, anon, authenticated", "i"),
      sequence + " must revoke direct client sequence privileges",
    );
  }
  assert.doesNotMatch(identitySequenceMigration, /GRANT\\s+.+\\s+TO\\s+(PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(identitySequenceMigration, /ALTER\\s+TABLE|ALTER\\s+SEQUENCE|DROP\\s+SEQUENCE|CREATE\\s+SEQUENCE/i);
  assert.match(identitySequenceMigration, /service_role grants/i);
});
