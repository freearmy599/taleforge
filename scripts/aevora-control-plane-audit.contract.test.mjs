import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./aevora-control-plane-audit.mjs", import.meta.url), "utf8");

test("missing audit configuration fails the workflow instead of looking healthy", () => {
  assert.match(source, /process\.exitCode\s*=\s*1;/);
  assert.doesNotMatch(source, /process\.exit\(0\);/);
  assert.match(source, /process\.exitCode\s*=\s*1;\s*\}\s*else\s*\{\s*\n\s*const findings/,
    "the audit request must not run after missing configuration has already been reported");
});

test("HTTP audit failures do not copy response bodies into logs or issue reports", () => {
  assert.match(source, /Audit endpoint returned HTTP \$\{response\.status\}/);
  assert.doesNotMatch(source, /const errorBody\s*=\s*await response\.text\(\)/);
  assert.doesNotMatch(source, /errorBody\.slice\(/);
});

test("stale, malformed, or future control-plane snapshots are reported", () => {
  assert.match(source, /parseTimestamp\(snapshot\.generated_at\)/);
  assert.match(source, /Malformed control-plane snapshot timestamp/);
  assert.match(source, /Control-plane snapshot timestamp is in the future/);
  assert.match(source, /Stale control-plane snapshot/);
  assert.match(source, /45 \* 60_000/);
});


test("GitHub API failures do not copy response bodies into logs or issue reports", () => {
  assert.match(source, /GitHub API returned HTTP \$\{response\.status\}/);
  assert.doesNotMatch(source, /GitHub API \$\{response\.status\}: \$\{\(await response\.text\(\)\)/);
});

test("audit failure remains bounded when GitHub issue reporting also fails", () => {
  assert.match(source, /try\s*\{\s*await report\(title, body\);\s*\}\s*catch \(reportError\)/);
  assert.match(source, /Audit failure report could not be delivered\./);
  assert.doesNotMatch(source, /String\(reportError\?\.message\s*\|\|\s*reportError\)/,
    "secondary GitHub/API failures must not leak response details or secret-bearing URLs into logs");
  assert.match(source, /process\.exitCode\s*=\s*1;/);
});

test("audit issue reports stay below GitHub's body-size limit on every reporting path", () => {
  assert.match(source, /const maxBodyLength = 60_000;/);
  assert.match(source, /body\.slice\(0, maxBodyLength - 80\)/);
  assert.match(source, /body: JSON\.stringify\(\{ body: boundedBody \}\)/);
  assert.match(source, /body: JSON\.stringify\(\{ title, body: boundedBody \}\)/);
  assert.match(source, /audit report truncated to stay within the GitHub issue body limit/);
});
