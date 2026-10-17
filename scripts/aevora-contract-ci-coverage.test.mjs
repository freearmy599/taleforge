/**
 * CI coverage guard for Aevora contract suites.
 * Prevents new source/security contract tests from silently remaining unexecuted.
 * Run with: node --test scripts/aevora-contract-ci-coverage.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDirectory = resolve(root, "scripts");
const workflowPath = resolve(root, ".github/workflows/aevora-edge-validation.yml");

 test("every Aevora test/contract module is explicitly executed by Edge validation CI", async () => {
  const files = await readdir(scriptsDirectory);
  const suites = files.filter((name) =>
    /^aevora-.*(?:test|contract).*\.mjs$/.test(name)
  ).sort();
  const workflow = await readFile(workflowPath, "utf8");

  assert.ok(suites.length > 0, "expected Aevora test/contract modules to exist");
  const missing = suites.filter((name) => !workflow.includes(name));
  assert.deepEqual(missing, [], "every contract suite must be wired into the workflow");
  assert.match(workflow, /Run Aevora contract CI coverage guard[\s\S]*?node --test scripts\/aevora-contract-ci-coverage\.test\.mjs/,
    "the coverage guard itself must run in CI");
});
