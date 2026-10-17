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


test("schedule advancement requires the complete selected batch to be confirmed", () => {
  assert.match(source, /function isConfirmedPublicationResponse\(r:any,d:any\):boolean\s*\{\s*return r\.ok && d!==null && typeof d===\"object\" && d\.success===true && d\.published===true && d\.status===\"published\" && typeof d\.chapter_id===\"string\" && d\.chapter_id\.length>0;/,
    "HTTP success alone must not qualify as publication success");
  assert.match(source, /const allSelectedConfirmed = !dryRun && schedule\.auto_publish && publishCount>0\s*&& attemptedCount===publishCount && published\.length===publishCount\s*&& !publicationFailed && !leaseLost;/,
    "the batch completion predicate must reject partial batches and lease loss");
  assert.match(source, /if\(!dryRun && nextRelease && allSelectedConfirmed\)/,
    "schedule advancement must be conditional on full batch confirmation");
});

test("scheduler verifies the persisted chapter before counting a publisher response", () => {
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const persistedChapterCheck = source.indexOf('from("chapters")', publisherCall);
  const confirmationCondition = source.indexOf('confirmedChapter.status!=="published"', persistedChapterCheck);
  assert.ok(publisherCall >= 0 && persistedChapterCheck > publisherCall,
    "scheduler must read the persisted chapter after publisher response");
  assert.ok(confirmationCondition > persistedChapterCheck,
    "scheduler must reject a chapter whose persisted status is not published");
});


test("persisted publication confirmation binds chapter ID, series, chapter number, and status", () => {
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const persistedChapterCheck = source.indexOf('from("chapters")', publisherCall);
  const query = source.slice(persistedChapterCheck, source.indexOf("published.push(", persistedChapterCheck));
  assert.match(query, /\.eq\("id",d\.chapter_id\)/,
    "the persisted row must be the exact chapter ID returned by the publisher");
  assert.match(query, /\.eq\("series_id",schedule\.series_id\)/,
    "a published chapter from another series must not confirm this schedule");
  assert.match(query, /\.eq\("chapter_number",candidate\.chapter_number\)/,
    "a different chapter slot must not confirm the candidate");
  assert.match(query, /confirmedChapter\.status!==\"published\"/,
    "the persisted chapter must be in published status");
});
