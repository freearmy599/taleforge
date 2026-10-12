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
