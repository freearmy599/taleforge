/**
 * Publication-boundary schema provenance inventory contract.
 * Static checks only: this file is never connected to a live database here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../docs/aevora/phase1-publication-schema-provenance.sql", import.meta.url),
  "utf8",
);
const executable = sql.replace(/--[^\n]*/g, "").trim();

test("publication schema provenance inventory contains SELECT statements only", () => {
  const statements = executable.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.ok(statements.length >= 9, "inventory must cover schemas, relations, columns, constraints, indexes, triggers, ACLs, routines, and policies");
  for (const statement of statements) {
    assert.match(statement, /^SELECT\b/i, "publication schema inventory must remain read-only");
    assert.doesNotMatch(
      statement,
      /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO|COPY|SET)\b/i,
      "inventory must not mutate objects, change session settings, or execute routines",
    );
  }
});

test("publication schema inventory covers commit-boundary relations and required catalog evidence", () => {
  for (const fragment of [
    "release_schedules",
    "series",
    "chapter_generation_outputs",
    "chapter_blueprints",
    "chapter_reviews",
    "chapter_publication_reviews",
    "aevora_release_scheduler_leases",
    "chapters",
    "publication_sync_outbox",
    "pg_namespace",
    "pg_class",
    "pg_attribute",
    "pg_catalog.acldefault('n', n.nspowner)",
    "pg_constraint",
    "pg_index",
    "pg_trigger",
    "pg_default_acl",
    "LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace",
    "d.defaclnamespace = 0",
    "'<global>'",
    "pg_policy",
    "aclexplode",
    "prosecdef",
    "proconfig",
  ]) {
    assert.ok(sql.includes(fragment), `inventory must inspect ${fragment}`);
  }
});

test("publication inventory pins catalog objects and helpers to pg_catalog", () => {
  assert.match(sql, /FROM pg_catalog\.pg_class/);
  assert.match(sql, /JOIN pg_catalog\.pg_namespace/);
  assert.match(sql, /pg_catalog\.aclexplode/);
  assert.match(sql, /pg_catalog\.acldefault/);
  assert.match(sql, /pg_catalog\.pg_get_userbyid/);
  assert.match(sql, /END::pg_catalog\."char"/);
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?!pg_catalog\.)pg_(?:class|namespace|attribute|attrdef|constraint|index|trigger|proc|default_acl|policy)\b/i,
    "catalog relations must not be shadowable through a caller-controlled search_path");
});

test("inventory is explicitly marked read-only and excludes application row payloads", () => {
  assert.match(sql, /READ ONLY/i);
  assert.match(sql, /No application rows are selected/i);
  assert.doesNotMatch(sql, /SELECT\s+\*\s+FROM\s+public\.(?:chapters|chapter_generation_outputs|chapter_reviews)/i);
});
