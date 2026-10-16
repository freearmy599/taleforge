/**
 * Fail-closed scheduler authorization-stop regression.
 *
 * Static source checks only. Does not invoke Edge Functions, Gemini, or Supabase.
 * The release scheduler must remain unable to reach publication-side effects
 * until the database commit-boundary authorization is implemented and approved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/release-scheduler/index.ts", import.meta.url),
  "utf8",
);

test("real auto-publish work stops before lease claims and publisher calls", () => {
  const guardStart = source.indexOf('if(!dryRun && schedule.auto_publish){');
  const guardEnd = source.indexOf('const leaseToken=crypto.randomUUID();', guardStart);
  assert.ok(guardStart >= 0, "scheduler must retain an explicit auto-publish authorization stop");
  assert.ok(guardEnd > guardStart, "authorization stop must precede lease-token creation");
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /publication_authorization_not_implemented/,
    "scheduler must report the stable fail-closed action");
  assert.match(guard, /continue;/,
    "real auto-publish schedule must exit the current iteration before side effects");

  const leaseClaim = source.indexOf('rpc("aevora_claim_release_scheduler_lease"');
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  assert.ok(leaseClaim > guardEnd, "lease claim must remain after the stop guard");
  assert.ok(publisherCall > guardEnd, "publisher HTTP call must remain after the stop guard");
});

test("authorization stop is scoped to real auto-publish work, preserving read-only dry-run diagnostics", () => {
  const guardStart = source.indexOf('if(!dryRun && schedule.auto_publish){');
  const guardEnd = source.indexOf('const leaseToken=crypto.randomUUID();', guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /!dryRun && schedule\.auto_publish/,
    "the stop must cover non-dry-run auto-publish only");
  assert.match(guard, /publication_authorization_not_implemented/,
    "dry-run must not be used as a path to bypass the real publication gate");
});
