/**
 * Static contract for the branch-only public-table maintenance privilege migration.
 * This test does not connect to or modify Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261016200000_revoke_client_table_maintenance_privileges.sql", import.meta.url),
  "utf8",
);

test("maintenance migration revokes RLS-bypassing/structural client privileges on public tables", () => {
  assert.match(migration, /n\.nspname\s*=\s*'public'/);
  assert.match(migration, /c\.relkind\s+IN\s*\('\s*r\s*',\s*'\s*p\s*'\)/);
  assert.match(
    migration,
    /REVOKE MAINTAIN, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    migration,
    /REVOKE REFERENCES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
    "column-level REFERENCES grants must also be removed",
  );
});

test("maintenance migration does not silently change client CRUD or trusted server-role grants", () => {
  assert.doesNotMatch(
    migration,
    /REVOKE\s+(?:ALL\s+PRIVILEGES|SELECT|INSERT|UPDATE|DELETE)\b/i,
    "this candidate only removes maintenance/structural privileges; CRUD requires separate reviewed migrations",
  );
  assert.doesNotMatch(migration, /\bGRANT\b/i, "this candidate must not add privileges");
  assert.doesNotMatch(migration, /\b(?:anon|authenticated|service_role|postgres)\s*;/i,
    "role statements must remain explicit and narrowly scoped");
});
