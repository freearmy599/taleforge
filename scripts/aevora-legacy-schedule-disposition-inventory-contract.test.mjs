import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("./aevora-legacy-schedule-disposition-inventory.sql", import.meta.url),
  "utf8",
);
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .trim();

test("legacy schedule disposition inventory is strictly read-only", () => {
  assert.ok(executable.startsWith("\\set ON_ERROR_STOP on\nBEGIN TRANSACTION READ ONLY;"));
  const statements = executable.split(";").map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) {
    if (statement.startsWith("\\set ")) continue;
    if (statement.toUpperCase() === "COMMIT") continue;
    assert.match(statement, /^SELECT\b/i, "inventory must contain only SELECT statements inside a read-only transaction");
    assert.doesNotMatch(statement, /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO|COPY)\b/i);
  }
});

test("inventory captures individual disposition evidence without exposing story content", () => {
  for (const fragment of [
    "public.release_schedules",
    "public.series",
    "rs.id AS schedule_id",
    "rs.series_id",
    "s.title AS series_title",
    "s.status AS series_status",
    "s.origin_type",
    "s.originality_status",
    "rs.schedule_mode",
    "rs.timezone",
    "rs.enabled",
    "rs.auto_generate",
    "rs.auto_publish",
    "rs.automation_ready_at",
    "s.originality_status = 'pending'",
    "rs.schedule_mode <> 'manual'",
    "s.origin_type = 'ai_original'",
    "count(*) OVER (PARTITION BY rs.series_id)",
  ]) {
    assert.ok(sql.includes(fragment), "inventory must include " + fragment);
  }
  assert.doesNotMatch(sql, /chapter_content|story_content|service_role_key|cron\.job\.command/i);
});
