export function safeRetryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Outbox completion write was not confirmed." ||
      message === "Publication sync attempt failed.") return message;
  const statusOnly = message.match(/^Canon sync failed: HTTP (\d{3})$/);
  if (statusOnly) return `Canon sync failed: HTTP ${statusOnly[1]}`;
  return "Publication sync attempt failed.";
}
