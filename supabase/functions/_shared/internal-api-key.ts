/**
 * Validate a server-to-server Supabase API key supplied in the apikey header.
 *
 * Supabase legacy service_role keys are JWTs; newer secret API keys are short
 * non-JWT strings. The latter must be sent in apikey, not treated as a JWT
 * bearer credential. Compare only against server-provided environment values.
 */
export function isTrustedInternalApiKey(
  presentedApiKey: string | null,
  legacyServiceRoleKey: string | null,
  secretKeysJson: string | null | undefined,
): boolean {
  if (!presentedApiKey) return false;
  const candidates: string[] = [];
  if (legacyServiceRoleKey) candidates.push(legacyServiceRoleKey);
  if (secretKeysJson) {
    try {
      const parsed: unknown = JSON.parse(secretKeysJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const value of Object.values(parsed)) {
          if (typeof value === "string" && value.length > 0) candidates.push(value);
        }
      }
    } catch {
      // Invalid optional secret-key configuration must not throw or bypass auth.
    }
  }
  return candidates.some((candidate) => candidate === presentedApiKey);
}
