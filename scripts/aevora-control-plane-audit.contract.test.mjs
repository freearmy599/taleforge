import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./aevora-control-plane-audit.mjs", import.meta.url), "utf8");

test("missing audit configuration fails the workflow instead of looking healthy", () => {
  assert.match(source, /process\.exitCode\s*=\s*1;/);
  assert.doesNotMatch(source, /process\.exit\(0\);/);
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
