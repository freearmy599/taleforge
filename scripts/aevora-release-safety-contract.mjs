/**
 * Aevora release safety contract tests.
 *
 * These pure tests encode the invariants the scheduler/publisher replacement
 * must satisfy. They do not call Supabase and do not publish or mutate data.
 * Run with: node --test scripts/aevora-release-safety-contract.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

export function isConfirmedPublication(httpOk, payload) {
  return httpOk === true
    && payload !== null
    && typeof payload === "object"
    && payload.success === true
    && payload.published === true
    && payload.status === "published"
    && typeof payload.chapter_id === "string"
    && payload.chapter_id.length > 0;
}

export function mayAdvanceSchedule({ dryRun, autoPublish, dueCount, attemptedCount, confirmedCount, failed }) {
  if (dryRun || !autoPublish || dueCount === 0) return false;
  if (failed === true) return false;
  return attemptedCount === dueCount && confirmedCount === dueCount;
}

export function mayActivateSeries({ requiredLaunchCount, approvedCount, publishedCount, publicationFailed }) {
  return Number.isInteger(requiredLaunchCount)
    && requiredLaunchCount > 0
    && approvedCount >= requiredLaunchCount
    && publishedCount >= requiredLaunchCount
    && publicationFailed !== true;
}

export function canContinueAfterLeaseLoss(leaseOwned, leaseRenewed) {
  return leaseOwned === true && leaseRenewed === true;
}

test("HTTP 200 alone is not publication success", () => {
  assert.equal(isConfirmedPublication(true, { success: false, published: false, status: "blocked" }), false);
  assert.equal(isConfirmedPublication(true, { success: true, published: true, status: "draft", chapter_id: "c1" }), false);
  assert.equal(isConfirmedPublication(false, { success: true, published: true, status: "published", chapter_id: "c1" }), false);
});

test("confirmed published chapter is accepted", () => {
  assert.equal(isConfirmedPublication(true, {
    success: true, published: true, status: "published", chapter_id: "chapter-1",
  }), true);
});

test("existing draft chapter cannot masquerade as published", () => {
  assert.equal(isConfirmedPublication(true, {
    success: true, published: true, status: "draft", chapter_id: "chapter-1", already_published: true,
  }), false);
});

test("schedule cannot advance after a partial publication failure", () => {
  assert.equal(mayAdvanceSchedule({
    dryRun: false, autoPublish: true, dueCount: 3, attemptedCount: 2,
    confirmedCount: 1, failed: true,
  }), false);
});

test("schedule advances only when every selected chapter is confirmed published", () => {
  assert.equal(mayAdvanceSchedule({
    dryRun: false, autoPublish: true, dueCount: 2, attemptedCount: 2,
    confirmedCount: 2, failed: false,
  }), true);
  assert.equal(mayAdvanceSchedule({
    dryRun: false, autoPublish: true, dueCount: 2, attemptedCount: 2,
    confirmedCount: 1, failed: false,
  }), false);
});

test("dry run never mutates the schedule", () => {
  assert.equal(mayAdvanceSchedule({
    dryRun: true, autoPublish: true, dueCount: 1, attemptedCount: 1,
    confirmedCount: 1, failed: false,
  }), false);
});

test("auto-publish disabled never advances as if a release happened", () => {
  assert.equal(mayAdvanceSchedule({
    dryRun: false, autoPublish: false, dueCount: 1, attemptedCount: 0,
    confirmedCount: 0, failed: false,
  }), false);
});

test("approval alone is insufficient to activate a series", () => {
  assert.equal(mayActivateSeries({
    requiredLaunchCount: 2, approvedCount: 2, publishedCount: 0, publicationFailed: false,
  }), false);
});

test("series activates only after launch threshold is truly published", () => {
  assert.equal(mayActivateSeries({
    requiredLaunchCount: 2, approvedCount: 2, publishedCount: 2, publicationFailed: false,
  }), true);
  assert.equal(mayActivateSeries({
    requiredLaunchCount: 2, approvedCount: 2, publishedCount: 1, publicationFailed: true,
  }), false);
});

test("lease loss or failed renewal must stop publication work", () => {
  assert.equal(canContinueAfterLeaseLoss(false, true), false);
  assert.equal(canContinueAfterLeaseLoss(true, false), false);
  assert.equal(canContinueAfterLeaseLoss(true, true), true);
});
