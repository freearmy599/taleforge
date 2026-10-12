/** Only reviewed-ready and already-published outputs may reach publication logic. */
export function isPublishableGenerationStatus(status: unknown): status is "approved" | "published" {
  return status === "approved" || status === "published";
}
