/**
 * Browser-to-RPC trust-boundary contract.
 *
 * Prevents browser-facing HTML/JS from directly invoking internal control-plane,
 * planner-write, readiness, or metrics RPCs. Public reader-facing RPCs are not
 * blocked by this test. Source-only: no network or database side effects.
 *
 * Run with: node --test scripts/aevora-browser-internal-rpc-boundary.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const ignoredDirectories = new Set([
  ".git", "node_modules", ".deno", ".next", "dist", "coverage",
]);

// These are trusted-server/internal functions, not browser APIs. Keep this list
// aligned with the explicit client EXECUTE revocations in the SQL migrations.
const forbiddenBrowserRpcs = [
  "apply_attachment_directives",
  "get_active_story_arc_plan",
  "get_production_buffer_plan",
  "get_story_narrative_destination",
  "prepare_next_chapter_blueprint",
  "refresh_story_attachment_metrics",
  "taleforge_get_long_term_architecture_context",
  "taleforge_score_story_opportunity",
  "taleforge_mark_release_automation_ready",
  "taleforge_check_autonomous_creation_gate",
  "taleforge_update_updated_at",
  "touch_story_lifecycle_updated_at",
  "update_series_chapter_count",
  "update_updated_at",
];

async function collectBrowserSources() {
  const files = [];
  const visited = new Set();

  async function walk(directory) {
    if (visited.has(directory.href)) return;
    visited.add(directory.href);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await walk(new URL(`${entry.name}/`, directory));
        }
      } else if (entry.isFile() && /\.(?:html|js|mjs)$/i.test(entry.name)) {
        files.push(new URL(entry.name, directory));
      }
    }
  }

  await walk(repositoryRoot);
  return [...new Map(files.map((file) => [file.href, file])).values()];
}

test("browser-facing sources cannot directly invoke internal Aevora RPCs", async () => {
  const files = await collectBrowserSources();
  assert.ok(files.length > 0, "browser source discovery must not silently return an empty set");

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const rpc of forbiddenBrowserRpcs) {
      // Match direct literal RPC calls regardless of client variable name or
      // quote style. Dynamic RPC names are outside this static contract.
      const pattern = new RegExp(
        String.raw`\.rpc\(\s*['"]${rpc}['"]\s*(?:,|\))`,
        "i",
      );
      if (pattern.test(source)) violations.push(`${file.pathname}: ${rpc}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `internal RPCs must remain server-only; browser invocation paths found: ${violations.join(", ")}`,
  );
});

test("browser-facing sources cannot bypass the RPC inventory with computed function names", async () => {
  const files = await collectBrowserSources();
  const violations = [];
  const literalStarts = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    // RPC names must be literal so the denylist and review process can classify them.
    const marker = ".rpc(";
    let offset = 0;
    while (true) {
      const index = source.indexOf(marker, offset);
      if (index < 0) break;
      let argument = index + marker.length;
      while (argument < source.length && source[argument].trim() === "") argument++;
      if (!literalStarts.includes(source[argument])) {
        const line = source.slice(0, index).split(String.fromCharCode(10)).length;
        violations.push(`${file.pathname}:${line}`);
      }
      offset = argument + 1;
    }
  }
  assert.deepEqual(violations, [],
    `browser RPC function names must remain literal and auditable: ${violations.join(", ")}`);
});
test("the protected RPC inventory includes control-plane, readiness, and trigger helpers", () => {
  for (const rpc of [
    "taleforge_mark_release_automation_ready",
    "taleforge_check_autonomous_creation_gate",
    "taleforge_update_updated_at",
    "touch_story_lifecycle_updated_at",
    "update_series_chapter_count",
    "update_updated_at",
  ]) {
    assert.ok(forbiddenBrowserRpcs.includes(rpc), `missing protected RPC: ${rpc}`);
  }
});

test("the browser RPC denylist covers every explicit internal-function EXECUTE revoke", async () => {
  const migrationUrl = new URL(
    "../supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql",
    import.meta.url,
  );
  const migration = await readFile(migrationUrl, "utf8");
  const revokedFunctions = [...migration.matchAll(
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi,
  )].map((match) => match[1].toLowerCase());

  assert.ok(revokedFunctions.length > 0, "internal RPC migration must contain explicit EXECUTE revokes");
  for (const rpc of revokedFunctions) {
    assert.ok(
      forbiddenBrowserRpcs.includes(rpc),
      `migration revokes ${rpc}, but the browser-boundary denylist does not cover it`,
    );
  }
});
