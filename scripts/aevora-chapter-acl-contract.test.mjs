/**
 * Chapter client-write ACL hardening contract.
 * Static checks only; the SQL fixture is run only against disposable PostgreSQL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261017130000_revoke_client_chapter_writes.sql", import.meta.url),
  "utf8",
);
const fixture = await readFile(
  new URL("./aevora-chapter-acl-fixture.sql", import.meta.url),
  "utf8",
);
const assertions = await readFile(
  new URL("./aevora-chapter-acl-assertions.sql", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("./test-aevora-chapter-acl.sh", import.meta.url),
  "utf8",
);

test("chapter ACL migration revokes client writes while explicitly preserving read access", () => {
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.chapters FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /REVOKE INSERT \(%1\$s\), UPDATE \(%1\$s\) ON TABLE public\.chapters FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.chapters TO anon, authenticated/i);
  assert.match(migration, /relkind IN \('r', 'p'\)/i);
  assert.match(migration, /required public\.chapters table is missing/i);
  assert.doesNotMatch(migration, /REVOKE[^;]*\bSELECT\b/i);
  assert.doesNotMatch(migration, /REVOKE[^;]*\b(?:INSERT|UPDATE|DELETE)\b[^;]*\bservice_role\b/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL PRIVILEGES)[^;]*\b(?:PUBLIC|anon|authenticated)\b/i);
});

test("disposable fixture proves permissive RLS policies do not substitute for write ACL revocation", () => {
  assert.match(fixture, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(fixture, /FOR INSERT TO anon, authenticated WITH CHECK \(true\)/i);
  assert.match(fixture, /FOR UPDATE TO anon, authenticated USING \(true\) WITH CHECK \(true\)/i);
  assert.match(fixture, /FOR DELETE TO anon, authenticated USING \(true\)/i);
  assert.match(fixture, /GRANT ALL PRIVILEGES ON TABLE public\.chapters TO anon, authenticated, service_role/i);
  assert.match(fixture, /GRANT INSERT \(title\), UPDATE \(content\)/i);
});

test("ACL assertions preserve client SELECT, remove table and column writes, and retain server CRUD", () => {
  assert.match(assertions, /has_table_privilege\(client_role, 'public\.chapters', 'SELECT'\)/);
  assert.match(assertions, /ARRAY\['INSERT', 'UPDATE', 'DELETE'\]/);
  assert.match(assertions, /has_column_privilege\(client_role, 'public\.chapters', 'title', privilege_name\)/);
  assert.match(assertions, /has_table_privilege\('service_role', 'public\.chapters', privilege_name\)/);
  assert.match(assertions, /fixture public chapter read/);
});

test("chapter ACL rehearsal refuses production-like or unconfirmed database targets", () => {
  assert.match(runner, /AEVORA_DISPOSABLE_CHAPTER_ACL_REHEARSAL/);
  assert.match(runner, /I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(runner, /supabase\\\.\(co\|com\)/);
  assert.match(runner, /pooler\\\.supabase\\\.com/);
  assert.match(runner, /database_name.*aevora_/);
  assert.match(runner, /20261017130000_revoke_client_chapter_writes\.sql/);
});
