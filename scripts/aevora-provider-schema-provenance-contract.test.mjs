/**
 * Provider-state schema provenance inventory contract.
 * Verifies the prepared SQL is catalog-only and read-only; it does not connect
 * to Supabase or execute the inventory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../docs/aevora/phase1-provider-state-schema-provenance.sql", import.meta.url),
  "utf8",
);
const executable = sql.replace(/--[^\n]*/g, "").trim();

test("provider schema provenance inventory contains only SELECT statements", () => {
  const statements = executable.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.ok(statements.length >= 8, "inventory should cover all documented catalog areas");
  for (const statement of statements) {
    assert.match(statement, /^SELECT\b/i, "schema provenance SQL must remain read-only");
    assert.doesNotMatch(
      statement,
      /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO|COPY)\b/i,
      "schema inventory must not mutate objects or execute routines",
    );
  }
});

test("provider schema provenance inventory covers schema needed before atomic RPC design", () => {
  for (const fragment of [
    "pg_class",
    "pg_attribute",
    "pg_constraint",
    "pg_index",
    "pg_trigger",
    "aclexplode",
    "pg_default_acl",
    "LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace",
    "d.defaclnamespace = 0",
    "'<global>'",
    "pg_proc",
    "taleforge_ai_provider_state",
  ]) {
    assert.ok(sql.includes(fragment), `inventory must inspect ${fragment}`);
  }
});
