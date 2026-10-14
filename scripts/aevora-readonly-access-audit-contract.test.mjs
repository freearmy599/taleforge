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

test("Phase 1 access audit contains only read-only SELECT statements", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "").trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 4, "expected four discrete metadata queries");
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
