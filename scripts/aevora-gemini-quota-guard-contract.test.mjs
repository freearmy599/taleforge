/**
 * Repository-wide static contract for direct Gemini API callers.
 *
 * This is source-only: it never calls Gemini or Supabase and never mutates data.
 * It prevents a new direct Gemini worker from omitting the shared provider-state
 * record, fail-closed state-unavailable handling, or active-cooldown rejection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../supabase/functions/", import.meta.url);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}

test("every direct Gemini API caller has fail-closed provider-state and cooldown guards", async () => {
  const files = await collect(root);
  const callers = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/generativelanguage\.googleapis\.com\/v1beta\/models\//i.test(source)) continue;
    callers.push({ path: file.pathname, source });
  }
  assert.ok(callers.length > 0, "the scan must find direct Gemini API callers");

  const failures = [];
  for (const { path, source } of callers) {
    const checks = [
      [/taleforge_ai_provider_state/.test(source), "does not read the persisted Gemini provider state"],
      [/provider_state_unavailable/.test(source), "does not fail closed when provider state is unavailable or invalid"],
      [/provider_cooldown/.test(source), "does not explicitly reject work during an active provider cooldown"],
      [/Date\.now\(\)/.test(source), "does not compare provider cooldown timestamps against the current time"],
    ];
    for (const [passed, reason] of checks) if (!passed) failures.push(`${path}: ${reason}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.ok(callers.length >= 10, `unexpectedly few direct Gemini callers were scanned: ${callers.length}`);
});
