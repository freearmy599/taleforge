# Release-handler service-role authentication — prepared branch only

## Finding

The production cron's Vault credential was checked without exposing its value: it is 41 characters, not JWT-shaped, and its prefix matches Supabase's newer `sb_secret_...` API-key format. Supabase's [API-key guide](https://supabase.com/docs/guides/getting-started/api-keys) says secret keys should be sent in `apikey` and authorized in handler code; its [Edge Function auth guide](https://supabase.com/docs/guides/functions/auth) recommends `verify_jwt=false` plus explicit secret-key validation for these calls. The handlers' earlier prepared guard compared `Authorization: Bearer ...` against `SUPABASE_SERVICE_ROLE_KEY`, which is the legacy JWT environment variable. Those credentials are not interchangeable, so that comparison could reject the legitimate cron caller. Supabase documents that new secret keys should be sent in `apikey` and authorized in handler code; `verify_jwt` alone is not authorization for these non-JWT keys. Without an explicit `apikey` check, a caller holding an ordinary anon/user token could attempt to invoke a release handler directly.

## Prepared change

Both prepared handlers now validate the incoming `apikey` against server-provided `SUPABASE_SECRET_KEYS` values and the legacy `SUPABASE_SERVICE_ROLE_KEY` compatibility value before constructing a database client. Other callers receive HTTP 401. The scheduler-to-publisher call forwards the legacy service-role key in both `Authorization` and `apikey`; the publisher accepts it through the compatibility fallback.

Deno source-contract coverage asserts both guards precede database-client creation, unauthorized responses are explicit, the scheduler-to-publisher call forwards the expected headers, and the shared API-key helper accepts configured secret keys but rejects publishable/user keys. A read-only production inspection confirmed `taleforge-release-tick` supplies both `Authorization` and `apikey` from the Vault secret named `taleforge_service_role_key`; only its length and JWT shape were checked, never its value. The secret is 41 characters and not JWT-shaped, so it must be validated as a newer secret API key rather than compared to the legacy service-role JWT. Hosted validation on the new API-key patch is pending.

## Required verification before deployment

- Confirm the Vault credential is present in `SUPABASE_SECRET_KEYS` at runtime and that its `apikey` header reaches both handlers. The values were intentionally not read or compared.
- Set the deployed functions' gateway `verify_jwt` behavior consistently with Supabase's current guidance for non-JWT secret keys (typically `verify_jwt=false`) while retaining the explicit handler-level `apikey` validation. Do not rely on the gateway's compatibility acceptance of a secret key in `Authorization` as the authorization control.
- Keep the hosted Deno checks and all 19 source-contract tests passing on subsequent changes.
- Run full-handler tests with a service-role caller (success path) and anon/user caller (401 path).
- Review whether any legitimate internal caller uses a distinct JWT or gateway-injected authorization header; if so, replace the raw role-key comparison with a dedicated server-side internal secret before deployment.

No production functions, schedules, rows, or chapters were changed. Do not deploy until these checks are complete.
