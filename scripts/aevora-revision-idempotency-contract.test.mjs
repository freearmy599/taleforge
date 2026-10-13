/**
 * Revision successor idempotency contract.
 * Static source checks only; does not apply migrations or mutate production.
 * Run with: node --test scripts/aevora-revision-idempotency-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("revision successor migration reconciles duplicates and installs a unique partial index", async () => {
  const migration = await source("supabase/migrations/20261013140000_aevora_revision_successor_idempotency.sql");
  assert.ok(migration.includes("HAVING count(*) > 1"));
  assert.ok(migration.includes("Multiple published revision successors exist; reconcile them manually before applying the unique index"));
  assert.ok(migration.includes("row_number() OVER"));
  assert.ok(migration.includes("WHEN 'published' THEN 0"));
  assert.ok(migration.includes("WHEN 'approved' THEN 1"));
  assert.ok(migration.includes("SET generation_status = 'rejected'"));
  assert.ok(migration.includes("AND output.generation_status <> 'published'"));
  assert.ok(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS chapter_generation_outputs_revision_successor_unique"));
  assert.ok(migration.includes("WHERE revision_of_output_id IS NOT NULL\n    AND generation_status <> 'rejected'"), "rejected successors must not prevent a retry");
  assert.equal(/DELETE\s+FROM\s+public\.chapter_generation_outputs/i.test(migration), false, "revision history must not be deleted");
});

test("revision worker maps concurrent unique-index conflicts to a safe 409", async () => {
  const worker = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(worker.includes('(insertError as { code?: unknown }).code === "23505"'));
  assert.ok(worker.includes('reason: "revision_successor_already_exists"'));
  assert.ok(worker.includes('}, 409);'));
  assert.equal(worker.includes("Could not save revised output: ${insertError.message}"), false, "database error details must not be exposed");
  assert.ok(worker.includes('"revision_of_output_id"') && worker.includes("existingRevision"), "worker must check for an existing successor before generating another");
});
