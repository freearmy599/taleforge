# Release-handler service-role authentication — prepared branch only

## Finding

The scheduler and publisher use the Supabase service-role key internally, while the Edge gateway's `verify_jwt=true` setting only establishes that the supplied JWT is valid. It does not by itself prove that the caller is the service role. Without an explicit caller check, a caller holding an ordinary anon/user token could attempt to invoke a release handler directly; the publisher's review gates reduce impact but are not a substitute for internal-only authorization.

## Prepared change

Both prepared handlers now compare the `Authorization` header to the exact configured `Bearer <SUPABASE_SERVICE_ROLE_KEY>` value before constructing the Supabase client or processing the request. Other callers receive HTTP 401. The scheduler-to-publisher call already supplies the service-role bearer token.

Deno source-contract coverage asserts both guards precede database-client creation, unauthorized responses are explicit, and the scheduler-to-publisher call forwards the server-side service-role bearer and apikey. GitHub Actions run `38230726454` on commit `8ba9f93125dc6b79731afad55dd98a2faa72e4cb` passed both Edge Function type checks and all 19 source-contract tests. These are source/type checks, not live authorization or end-to-end handler tests. A separate read-only production cron inspection confirmed `taleforge-release-tick` invokes the release scheduler and supplies both `Authorization: Bearer …` and `apikey` from the Vault secret named `taleforge_service_role_key`; secret values were not read or exposed.

## Required verification before deployment

- Confirm the `taleforge_service_role_key` Vault value exactly matches the prepared function's `SUPABASE_SERVICE_ROLE_KEY` environment value; the cron's header structure is confirmed, but the secret values were intentionally not read or compared.
- Keep the hosted Deno checks and all 19 source-contract tests passing on subsequent changes.
- Run full-handler tests with a service-role caller (success path) and anon/user caller (401 path).
- Review whether any legitimate internal caller uses a distinct JWT or gateway-injected authorization header; if so, replace the raw role-key comparison with a dedicated server-side internal secret before deployment.

No production functions, schedules, rows, or chapters were changed. Do not deploy until these checks are complete.
