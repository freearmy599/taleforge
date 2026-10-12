/**
 * Validate a server-to-server Supabase API key supplied in the apikey header.
 *
 * Legacy service_role JWTs remain supported for compatibility. Newer secret
 * keys are accepted only when their JSON object key names are explicitly
 * allowlisted in AEVORA_INTERNAL_API_KEY_NAMES (comma-separated). An unset or
 * invalid allowlist must never implicitly trust every project secret.
 */
export function isTrustedInternalApiKey(
  presentedApiKey: string | null,
  legacyServiceRoleKey: string | null,
  secretKeysJson: string | null | undefined,
  allowedSecretKeyNamesCsv: string | null | undefined,
): boolean {
  if (!presentedApiKey) return false;
  if (legacyServiceRoleKey && presentedApiKey === legacyServiceRoleKey) return true;
  if (!secretKeysJson || !allowedSecretKeyNamesCsv) return false;

  const allowedNames = new Set(
    allowedSecretKeyNamesCsv.split(",").map((name) => name.trim()).filter(Boolean),
  );
  if (allowedNames.size === 0) return false;

  try {
    const parsed: unknown = JSON.parse(secretKeysJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.some(([name, value]) =>
      allowedNames.has(name) && typeof value === "string" &&
      value.length > 0 && value === presentedApiKey
    );
  } catch {
    // Invalid optional secret-key configuration must not throw or bypass auth.
    return false;
  }
}
