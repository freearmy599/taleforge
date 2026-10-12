export type PublishedChapterHistoryResult =
  | { ok: true; latestNumber: number; firstMissingChapter: number | null }
  | { ok: false; reason: "invalid_chapter_number" };

/** Validate published chapter numbers and detect holes without iterating up to an untrusted MAX value. */
export function inspectPublishedChapterHistory(values: unknown[]): PublishedChapterHistoryResult {
  const numbers = values.map((value) => Number(value));
  if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1)) {
    return { ok: false, reason: "invalid_chapter_number" };
  }
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  let expected = 1;
  for (const number of sorted) {
    if (number < expected) continue;
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
