/** Resolve an interval release timestamp without allowing overflow or a non-advancing deadline. */
export function resolveNextIntervalRelease(base: Date, intervalHours: unknown): Date {
  const baseMs = base instanceof Date ? base.getTime() : Number.NaN;
  // Accept numeric values and non-empty numeric strings from database drivers, but
  // do not coerce booleans, arrays, or empty strings into plausible intervals.
  const hours = typeof intervalHours === "number"
    ? intervalHours
    : typeof intervalHours === "string" && intervalHours.trim().length > 0
      ? Number(intervalHours)
      : Number.NaN;
  if (!Number.isFinite(baseMs)) throw new Error("Invalid interval base timestamp");
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("Invalid interval_hours");
  const releaseAt = new Date(baseMs + hours * 3_600_000);
  if (!Number.isFinite(releaseAt.getTime()) || releaseAt.getTime() <= baseMs) {
    throw new Error("Interval release timestamp is outside the supported date range");
  }
  return releaseAt;
}
