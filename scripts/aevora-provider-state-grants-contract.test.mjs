/**
 * Provider-state grants contract.
 * Source-level checks only; this does not apply the migration or query production.
 * Run with: node --test scripts/aevora-provider-state-grants-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261013120000_lock_ai_provider_state_table.sql", import.meta.url),
  "utf8",
);

test("Gemini provider state is server-side only", () => {
  assert.ok(migration.includes("ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"));
  assert.equal(/CREATE POLICY/i.test(migration), false, "internal provider state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(migration), false, "migration must not re-grant client access");
});
