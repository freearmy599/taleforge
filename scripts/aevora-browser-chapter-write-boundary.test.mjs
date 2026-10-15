/**
 * Dynamic browser-side chapter write boundary.
 *
 * Scans root-level browser entrypoints and common static asset directories so a
 * newly added HTML/JS entrypoint cannot silently bypass release-publisher.
 * Source-only: no network calls, database access, or publication side effects.
 *
 * Run with: node --test scripts/aevora-browser-chapter-write-boundary.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const assetDirectories = ["public", "assets", "js", "static"];

async function collectBrowserSources() {
  const files = [];
  const visited = new Set();

  async function walk(directory, includeAllScripts = false) {
    const key = directory.href;
    if (visited.has(key)) return;
    visited.add(key);

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        if (includeAllScripts) await walk(child, true);
        continue;
      }
      if (!entry.isFile()) continue;
      const isBrowserSource = /\.(?:html|js|mjs)$/i.test(entry.name);
      if (!isBrowserSource) continue;
      // The repository root includes build/test tooling; only its browser entry
      // files are scanned. Common asset directories are scanned recursively.
      files.push(child);
    }
  }

  await walk(repositoryRoot);
  for (const directory of assetDirectories) {
    await walk(new URL(`${directory}/`, repositoryRoot), true);
  }
  return [...new Map(files.map((file) => [file.href, file])).values()];
}

test("all discovered browser entrypoints and static JS assets cannot write chapter rows directly", async () => {
  const files = await collectBrowserSources();
  assert.ok(files.length > 0, "browser source discovery must not silently return an empty set");

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\.from\(["']chapters["']\)\s*\.(?:insert|upsert|update|delete)\s*\(/i.test(source)) {
      violations.push(file.pathname);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `browser-facing code must route chapter writes through release-publisher; direct write paths: ${violations.join(", ")}`,
  );
});
