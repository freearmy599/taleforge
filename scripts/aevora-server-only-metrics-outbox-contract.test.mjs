/**
 * Server-only telemetry/outbox ACL migration contract.
 *
 * Static checks only; runtime ACL behavior is rehearsed separately against
 * disposable PostgreSQL. Never runs against a connected Supabase project.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url),
  "utf8",
);

test("publication outbox and attachment metrics remain server-only", () => {
  for (const relation of ["publication_sync_outbox", "story_attachment_metrics"]) {
    assert.match(
      migration,
      new RegExp("'" + relation + "'"),
      `migration must explicitly cover public.${relation}`,
    );
  }
  assert.match(migration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
    "relation-level grants must be revoked from all client/public roles",
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
    "column-level grants must also be revoked",
  );
});

test("migration preserves trusted server-role grants and does not expose a client API", () => {
  assert.doesNotMatch(
    migration,
    /\b(?:GRANT|REVOKE)[^;]*\bservice_role\b/i,
    "this migration must not alter the trusted service_role ACL",
  );
  assert.doesNotMatch(
    migration,
    /CREATE POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL PRIVILEGES)[^;]*\b(?:PUBLIC|anon|authenticated)\b/i,
    "server-only telemetry and outbox tables must not gain client policies or grants",
  );
  assert.match(migration, /IF to_regclass\(format\('public\.%I', table_name\)\) IS NOT NULL/i);
});
