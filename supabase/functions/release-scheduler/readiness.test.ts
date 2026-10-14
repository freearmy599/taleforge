import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { automationReadinessDisposition, isAutomationReady } from "./readiness.ts";

Deno.test("automation readiness fails closed for missing or malformed markers", () => {
  assertEquals(isAutomationReady(null), false);
  assertEquals(isAutomationReady(undefined), false);
  assertEquals(isAutomationReady(""), false);
  assertEquals(isAutomationReady("   "), false);
  assertEquals(isAutomationReady("not-a-timestamp"), false);
});

Deno.test("a valid server readiness timestamp qualifies the marker", () => {
  assertEquals(isAutomationReady("2026-10-14T07:00:00.000Z"), true);
});

Deno.test("real release work is blocked until readiness is present", () => {
  assertEquals(automationReadinessDisposition(null, false), "blocked_unready");
  assertEquals(automationReadinessDisposition("invalid", false), "blocked_unready");
  assertEquals(automationReadinessDisposition("2026-10-14T07:00:00Z", false), "ready");
});

Deno.test("dry-run can inspect but never confers release eligibility", () => {
  assertEquals(automationReadinessDisposition(null, true), "inspect_only_unready");
  assertEquals(automationReadinessDisposition("2026-10-14T07:00:00Z", true), "ready");
});
