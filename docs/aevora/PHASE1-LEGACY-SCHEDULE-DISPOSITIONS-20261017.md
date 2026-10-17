# Phase 1 — Read-only legacy release-schedule disposition review

Date: 2026-10-17  
Project: live Supabase project `sxmbnlgufqhcwxcpcsvb`  
Scope: metadata-only SELECTs against `public.release_schedules` joined to `public.series`. No chapter content, secrets, or reader data queried. No rows or schedules changed.

## Result

The live database contains six release-schedule rows. All six are enabled, use `schedule_mode = interval`, have `auto_generate = true`, and have `auto_publish = false`. Thus these records currently express automatic generation but do not request automatic publication. This does **not** prove that generation is healthy or that the deployed scheduler enforces the same guards as the branch.

The live `release_schedules` schema does **not** contain `automation_ready_at`, while the current hardening branch expects that field in its readiness checks. This is a concrete branch/live schema drift signal; do not deploy the branch or alter schedules until schema compatibility is reconciled.

## Per-row disposition

| Series | Schedule ID | Series status | Enabled / generate / publish | Next release (UTC) | Read-only disposition |
|---|---|---|---|---|---|
| The Clockwork Sky | `5050a578-b234-4912-910d-68eee406bed4` | ongoing | true / true / false | 2026-10-17 22:55:01 | HOLD unchanged. Future cursor; verify generation job and chapter evidence before interpreting this as healthy. |
| The House That Grows Rooms | `0244c5a6-9bf6-48cc-a8a9-52f8bd0a396f` | ongoing | true / true / false | 2026-10-06 00:00:00 | INVESTIGATE stale cursor. No last-release timestamp is recorded. Do not advance/reset it without evidence and authorization. |
| The Last Unsent Letter | `3ebb5363-4482-4073-8e3d-d6f2e0085d3e` | ongoing | true / true / false | 2026-10-18 14:55:01 | HOLD unchanged. Cursor is future-dated; verify generation outcomes separately. |
| The Hollow Crown | `79e3541c-c885-49a9-a3de-4c861e7aa888` | ongoing | true / true / false | 2026-10-18 14:55:01 | HOLD unchanged. Cursor is future-dated; verify generation outcomes separately. |
| After the Red Eclipse | `b1162b50-9912-4858-a3e1-98471f90c78e` | ongoing | true / true / false | 2026-10-18 14:55:01 | HOLD unchanged. Cursor is future-dated; verify generation outcomes separately. |
| TaleForge Autonomous Pipeline Test | `56dc99c8-4b43-4d7b-a725-037c0781e7e1` | ongoing | true / true / false | 2026-10-18 08:40:00 | HOLD unchanged. Name suggests a test series, but its live row is enabled and ongoing; confirm intended disposition before any change. |

## Guardrails and next steps

- No schedule was disabled, re-enabled, advanced, or reset.
- Do not infer successful chapter generation from `next_release_at` or `last_release_at` alone. Correlate queue/job records, generated outputs, review results, and published chapter rows before deciding what happened.
- Do not classify the test-named series as disposable based on its title alone.
- Before any rollout, reconcile the missing live `automation_ready_at` column and other branch/live schema differences through an authorized migration path.
- Automated publication remains **NO-GO** until trusted, auditable approval for the exact output is enforced at the database commit boundary and the deployed scheduler/publisher behavior is verified.

Evidence source: read-only SQL metadata query on 2026-10-17. This is a snapshot, not a continuous monitor or proof of end-to-end runtime health.
