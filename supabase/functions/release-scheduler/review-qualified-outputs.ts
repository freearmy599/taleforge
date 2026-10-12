export type ReviewQualifiedOutput = {
  id?: unknown;
};

export type PublicationReview = {
  generation_output_id?: unknown;
  decision?: unknown;
  quality_passed?: unknown;
  continuity_passed?: unknown;
  originality_passed?: unknown;
  safety_passed?: unknown;
};

/** Keep only outputs with exactly one explicitly approved review and four passing gates. */
export function qualifyReviewedOutputs<T extends ReviewQualifiedOutput>(
  outputs: T[],
  reviews: PublicationReview[],
): T[] {
  const byOutput = new Map<string, PublicationReview[]>();
  for (const review of reviews) {
    const id = typeof review?.generation_output_id === "string"
      ? review.generation_output_id
      : "";
    if (!id) continue;
    const rows = byOutput.get(id) ?? [];
    rows.push(review);
    byOutput.set(id, rows);
  }

  const qualifiedIds = new Set<string>();
  for (const [id, rows] of byOutput) {
    if (rows.length !== 1) continue;
    const review = rows[0];
    if (
      review.decision === "approved" &&
      review.quality_passed === true &&
      review.continuity_passed === true &&
      review.originality_passed === true &&
      review.safety_passed === true
    ) qualifiedIds.add(id);
  }

  return outputs.filter((output) =>
    typeof output?.id === "string" && qualifiedIds.has(output.id)
  );
}

/** Verify that a published chapter is the same reviewed output, not just the same chapter number. */
export function matchesPublishedChapterOutput(
  chapter: {
    status?: unknown;
    series_id?: unknown;
    chapter_number?: unknown;
    title?: unknown;
    content?: unknown;
  } | null | undefined,
  output: {
    series_id?: unknown;
    chapter_number?: unknown;
    title?: unknown;
    content?: unknown;
  } | null | undefined,
): boolean {
  const chapterNumber = Number(chapter?.chapter_number);
  const outputNumber = Number(output?.chapter_number);
  const chapterTitle = typeof chapter?.title === "string" ? chapter.title.trim() : "";
  const outputTitle = typeof output?.title === "string" ? output.title.trim() : "";
  const chapterContent = typeof chapter?.content === "string" ? chapter.content.trim() : "";
  const outputContent = typeof output?.content === "string" ? output.content.trim() : "";
  return chapter?.status === "published" &&
    chapter?.series_id === output?.series_id &&
    Number.isSafeInteger(chapterNumber) && chapterNumber > 0 &&
    Number.isSafeInteger(outputNumber) && outputNumber > 0 &&
    chapterNumber === outputNumber &&
    chapterTitle.length > 0 && chapterTitle === outputTitle &&
    chapterContent.length > 0 && chapterContent === outputContent;
}
