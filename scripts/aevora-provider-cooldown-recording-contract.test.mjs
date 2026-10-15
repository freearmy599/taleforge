/**
 * Provider cooldown recording source-contract regression.
 * Static checks only; does not call Gemini or mutate Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url),
  "utf8",
);
const catchStart = source.indexOf("const providerQuotaFailure=");
const catchEnd = source.indexOf('const failureReason=', catchStart);
assert.notEqual(catchStart, -1, "provider failure handling must exist");
assert.notEqual(catchEnd, -1, "provider failure handler must have a bounded end");
const handler = source.slice(catchStart, catchEnd);

test("provider-state lookup binds Supabase error to stateError", () => {
  assert.match(
    handler,
    /const\s*\{\s*data\s*,\s*error\s*:\s*stateError\s*\}\s*=\s*await\s+db\.from\("taleforge_ai_provider_state"\)/,
    "the Supabase error field must be aliased; data,stateError silently misses lookup errors",
  );
  assert.doesNotMatch(
    handler,
    /const\s*\{\s*data\s*,\s*stateError\s*\}\s*=/,
    "do not destructure a nonexistent stateError property",
  );
});

test("provider-state lookup failure preserves existing cooldown state", () => {
  assert.match(handler, /if\s*\(stateError\s*\|\|\s*!data\)/);
  assert.match(
    handler,
    /Gemini cooldown state could not be verified; existing state preserved/,
  );
  assert.match(
    handler,
    /if\s*\(cooldownError\)\s*console\.error/,
    "cooldown upsert errors must be logged rather than reported as successful",
  );
});
