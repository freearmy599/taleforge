# Aevora autonomous-series runner — secret-key caller correction (2026-10-17)

## Read-only production finding

The live cron metadata for job 13, `taleforge-autonomous-series-creation`, was inspected without retrieving the raw cron command or secret value. The result confirms:

- The command references `Authorization` but has no `apikey` header reference.
- The command includes the scheduled mode.
- The referenced Vault secret is named `taleforge_service_role_key`; only metadata was returned: length 41, `sb_secret_...` format, and not JWT-shaped.
- The deployed `autonomous-series-creation-runner` is version 6 with `verify_jwt=true`. Its source expects the scheduled credential as a legacy service-role JWT in `Authorization: Bearer ...`, then compares it with `SUPABASE_SERVICE_ROLE_KEY`.

This is a confirmed credential-format mismatch. Supabase documents that new secret API keys are not JWTs, should be sent through `apikey`, and cannot be used as a Bearer JWT. The gateway's legacy `verify_jwt` check does not validate new secret keys. References:
- [Supabase: Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase: Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)

The cron was not executed, and its command text and secret value were not retrieved or changed.

## Branch-only handler correction

The branch candidate in `supabase/functions/autonomous-series-creation-runner/index.ts` now:
- Validates `apikey` for `mode: "scheduled"` through the shared `isTrustedInternalApiKey` helper.
- Fails closed when the key is missing or not covered by the explicit `AEVORA_INTERNAL_API_KEY_NAMES` allowlist (while retaining legacy service-role JWT compatibility).
- Continues to validate `admin_execute` through Supabase Auth and the application `admin`/`owner` role.
- Creates the privileged database client only after the selected mode passes authentication.
- Uses an updated source marker: `aevora-autonomous-series-runner-v4-secret-key-scheduled-auth`.

The branch config now explicitly sets `verify_jwt = false` for this function. This does **not** make the endpoint public by design: the handler must enforce scheduled-key or admin-session authorization on every request. A source-contract test now asserts these boundaries.

## Required caller change before deployment

The deployed cron currently sends the secret in `Authorization` and does not send `apikey`. The branch handler will not accept that old scheduled request shape. An authorized future rollout must update the cron command to:

1. Keep its existing scheduled-mode request body and cadence.
2. Send the Vault credential in the `apikey` header.
3. Remove the non-JWT secret from `Authorization: Bearer ...`; do not put the new secret key in that header.
4. Confirm the Edge Function runtime has `SUPABASE_SECRET_KEYS` and that `AEVORA_INTERNAL_API_KEY_NAMES` explicitly allows the intended key name.
5. Deploy the handler and update the cron command in a coordinated, reviewed window; test a harmless authenticated path or a safe dry-run that cannot create a series.
6. Verify sanitized HTTP/application outcome and rollback readiness. Do not trigger actual series creation or chapter publication as a smoke test.

Because the cron command is a live production setting, this runbook is not authorization to update it. Obtain explicit owner approval and prepare a rollback that restores the exact prior command from a protected baseline. Never print or commit the secret or raw cron command.

## Safety and status

- No live function deployment, cron update, secret read, schedule mutation, series creation, chapter generation, or publication occurred.
- The handler/config/test changes are branch-only and require passing CI.
- Production autonomous-series creation remains blocked pending coordinated caller/handler remediation and explicit approval.
