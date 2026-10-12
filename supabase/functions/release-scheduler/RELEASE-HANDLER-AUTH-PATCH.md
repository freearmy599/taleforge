# Release-handler service-role authentication — prepared branch only

## Finding

The scheduler and publisher use the Supabase service-role key internally, while the Edge gateway's `verify_jwt=true` setting only establishes that the supplied JWT is valid. It does not by itself prove that the caller is the service role. Without an explicit caller check, a caller holding an ordinary anon/user token could attempt to invoke a release handler directly; the publisher's review gates reduce impact but are not a substitute for internal-only authorization.

## Prepared change

Both prepared handlers now compare the `Authorization` header to the exact configured `Bearer <SUPABASE_SERVICE_ROLE_KEY>` value before constructing the Supabase client or processing the request. Other callers receive HTTP 401. The scheduler-to-publisher call already supplies the service-role bearer token.

A new Deno source-contract test asserts both guards precede database-client creation and unauthorized responses are explicit. This is a source-level regression check, not a live security test.

## Required verification before deployment

- Confirm the configured Supabase Cron/HTTP caller uses the exact service-role bearer credential expected by the function.
- Run the latest hosted Deno checks and all 19 source-contract tests.
- Run full-handler tests with a service-role caller (success path) and anon/user caller (401 path).
- Review whether any legitimate internal caller uses a distinct JWT or gateway-injected authorization header; if so, replace the raw role-key comparison with a dedicated server-side internal secret before deployment.

No production functions, schedules, rows, or chapters were changed. Do not deploy until these checks are complete.
