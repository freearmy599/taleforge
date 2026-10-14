\set ON_ERROR_STOP on

do $rollback_schema_assert$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='release_schedules' and column_name='automation_ready_at') then
    raise exception 'ASSERTION_FAILED: readiness column remains after rollback';
  end if;
  if to_regclass('public.release_schedules_ready_due_idx') is not null then
    raise exception 'ASSERTION_FAILED: readiness partial index remains after rollback';
  end if;
  if to_regclass('public.taleforge_release_readiness_authorizations') is not null then
    raise exception 'ASSERTION_FAILED: readiness authorization table remains after rollback';
  end if;
  if to_regprocedure('public.taleforge_mark_release_automation_ready(uuid)') is not null
     or to_regprocedure('public.taleforge_lock_release_schedule_parent()') is not null
     or to_regprocedure('public.taleforge_revoke_ambiguous_release_schedules()') is not null
     or to_regprocedure('public.taleforge_protect_release_automation_readiness()') is not null
     or to_regprocedure('public.taleforge_guard_chapter_publication_lifecycle()') is not null then
    raise exception 'ASSERTION_FAILED: candidate readiness function remains after rollback';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.series'::regclass and tgname='trg_enroll_series_in_production' and not tgisinternal) then
    raise exception 'ASSERTION_FAILED: baseline enrollment trigger missing after rollback';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger where not tgisinternal and tgname in ('trg_lock_release_schedule_parent','trg_revoke_ambiguous_release_schedules','trg_protect_release_automation_readiness','trg_guard_chapter_publication_lifecycle')) then
    raise exception 'ASSERTION_FAILED: candidate trigger remains after rollback';
  end if;
end;
$rollback_schema_assert$;

do $rollback_acl_assert$
begin
  if not has_table_privilege('anon','public.release_schedules','select')
     or not has_table_privilege('authenticated','public.release_schedules','select')
     or not has_table_privilege('service_role','public.release_schedules','select') then
    raise exception 'ASSERTION_FAILED: fixture baseline release_schedules grants were not restored';
  end if;
  if not has_column_privilege('anon','public.release_schedules','id','select')
     or not has_column_privilege('authenticated','public.release_schedules','auto_publish','update') then
    raise exception 'ASSERTION_FAILED: fixture baseline column grants were not restored';
  end if;
end;
$rollback_acl_assert$;

do $rollback_fail_closed_assert$
begin
  if exists (select 1 from public.release_schedules where enabled or auto_generate or auto_publish) then
    raise exception 'ASSERTION_FAILED: rollback re-enabled a schedule without independent approval evidence';
  end if;
end;
$rollback_fail_closed_assert$;

do $rollback_function_baseline_assert$
declare v_result jsonb;
begin
  v_result := public.taleforge_check_autonomous_creation_gate('00000000-0000-0000-0000-000000000201'::uuid, 80);
  if v_result->>'reason' is distinct from 'fixture_pre_migration_stub' then
    raise exception 'ASSERTION_FAILED: baseline creation-gate function body was not restored';
  end if;
end;
$rollback_function_baseline_assert$;

select 'release readiness rollback/restore assertions passed; all schedules remain disabled' as result;
