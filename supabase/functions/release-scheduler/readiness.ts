/** Server-controlled readiness checks for autonomous release scheduling. */
export function isAutomationReady(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

/**
 * Readiness is mandatory for every real publication path. Dry runs may inspect
 * unready schedules, but callers must not treat inspection as eligibility.
 */
export function automationReadinessDisposition(
  automationReadyAt: unknown,
  dryRun: boolean,
): "ready" | "inspect_only_unready" | "blocked_unready" {
  if (isAutomationReady(automationReadyAt)) return "ready";
  return dryRun ? "inspect_only_unready" : "blocked_unready";
}
