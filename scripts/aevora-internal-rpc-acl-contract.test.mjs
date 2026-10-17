/**
 * Internal invoker-RPC ACL hardening contract.
 * Static checks only; SQL rehearsal runs only on an explicitly disposable PostgreSQL database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql", import.meta.url), "utf8");
const fixture = await readFile(new URL("./aevora-internal-rpc-acl-fixture.sql", import.meta.url), "utf8");
const assertions = await readFile(new URL("./aevora-internal-rpc-acl-assertions.sql", import.meta.url), "utf8");
const runner = await readFile(new URL("./test-aevora-internal-rpc-acl.sh", import.meta.url), "utf8");

test("RPC migration removes client EXECUTE while preserving service_role access", () => {
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.apply_attachment_directives\(uuid\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.update_series_chapter_count\(\) FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(migration, /REVOKE EXECUTE[^;]*\bservice_role\b/i);
  assert.match(fixture, /GRANT EXECUTE ON FUNCTION public\.apply_attachment_directives\(uuid\) TO anon, authenticated, service_role/i);
  assert.match(assertions, /has_function_privilege\('service_role', target, 'EXECUTE'\)/);
  assert.match(assertions, /has_function_privilege\('anon', target, 'EXECUTE'\)/);
  assert.match(assertions, /has_function_privilege\('authenticated', target, 'EXECUTE'\)/);
});

test("rehearsal proves trigger functions still run after direct EXECUTE revocation", () => {
  assert.match(fixture, /CREATE TRIGGER aevora_rpc_acl_trigger_fixture[\s\S]*?EXECUTE FUNCTION public\.taleforge_update_updated_at\(\)/i);
  assert.match(assertions, /SET ROLE anon;[\s\S]*?INSERT INTO public\.aevora_rpc_acl_trigger_source[\s\S]*?UPDATE public\.aevora_rpc_acl_trigger_source/i);
  assert.match(assertions, /updated_at IS NOT NULL/i);
  assert.match(assertions, /trigger function stopped working after client EXECUTE revocation/i);
});

test("rehearsal explicitly checks direct client RPC denial", () => {
  assert.match(runner, /SET ROLE anon; SELECT public\.apply_attachment_directives/);
  assert.match(runner, /permission denied for function apply_attachment_directives/i);
  assert.match(runner, /ASSERTION_FAILED: anon directly executed internal RPC/i);
});

test("runner requires explicit disposable database and refuses Supabase URLs", () => {
  assert.match(runner, /AEVORA_DISPOSABLE_RPC_ACL_REHEARSAL/);
  assert.match(runner, /I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(runner, /supabase\\\.\(co\|com\)/);
  assert.match(runner, /pooler\\\.supabase\\\.com/);
  assert.match(runner, /database_name.*aevora_/);
  assert.match(runner, /20261013110000_restrict_internal_invoker_rpc_execution\.sql/);
});
