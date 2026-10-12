export type PublishedChapterHistoryResult =
  | { ok: true; latestNumber: number; firstMissingChapter: number | null }
  | { ok: false; reason: "invalid_chapter_number" | "duplicate_chapter_number" };

/** Validate published chapter numbers and detect duplicates/gaps without iterating up to an untrusted MAX value. */
export function inspectPublishedChapterHistory(values: unknown[]): PublishedChapterHistoryResult {
  const numbers = values.map((value) => {
    // Database chapter numbers are integers; allow only integer numbers or
    // plain decimal digit strings. Number(value) alone would coerce true,
    // [1], hexadecimal, and exponent strings into plausible chapter numbers.
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
    return Number.NaN;
  });
  if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1)) {
    return { ok: false, reason: "invalid_chapter_number" };
  }
  const seen = new Set<number>();
  for (const number of numbers) {
    if (seen.has(number)) return { ok: false, reason: "duplicate_chapter_number" };
    seen.add(number);
  }
  const sorted = Array.from(seen).sort((a, b) => a - b);
  let expected = 1;
  for (const number of sorted) {
    if (number !== expected) {
      return {
        ok: true,
        latestNumber: sorted[sorted.length - 1] ?? 0,
        firstMissingChapter: expected,
      };
    }
    expected++;
  }
  return {
    ok: true,
    latestNumber: sorted[sorted.length - 1] ?? 0,
    firstMissingChapter: null,
  };
}
