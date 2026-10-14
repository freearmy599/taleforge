-- Fixture-only rollback for 20261014210000_release_automation_readiness_gate.sql.
-- Deliberately fail closed: do not restore legacy automation flags from memory.
\set ON_ERROR_STOP on
begin;

update public.release_schedules
set enabled = false, auto_generate = false, auto_publish = false,
    automation_ready_at = null, updated_at = now();

drop trigger if exists trg_guard_chapter_publication_lifecycle on public.chapters;
drop trigger if exists trg_protect_release_automation_readiness on public.release_schedules;
drop trigger if exists trg_revoke_ambiguous_release_schedules on public.release_schedules;
drop trigger if exists trg_lock_release_schedule_parent on public.release_schedules;

drop function if exists public.taleforge_guard_chapter_publication_lifecycle();
drop function if exists public.taleforge_mark_release_automation_ready(uuid);
drop function if exists public.taleforge_protect_release_automation_readiness();
drop function if exists public.taleforge_revoke_ambiguous_release_schedules();
drop function if exists public.taleforge_lock_release_schedule_parent();

drop index if exists public.release_schedules_ready_due_idx;
drop table if exists public.taleforge_release_readiness_authorizations;
alter table public.release_schedules drop column if exists automation_ready_at;

-- Restore the exact pre-migration function bodies represented by this
-- versioned disposable fixture, not a production baseline.
create or replace function public.taleforge_enroll_series_in_production()
returns trigger language plpgsql as $function$
begin
  return new;
end;
$function$;

create or replace function public.taleforge_check_autonomous_creation_gate(
  p_opportunity_id uuid,
  p_concept_overall_score numeric default null
)
returns jsonb language sql stable as $function$
  select jsonb_build_object(
    'allowed', false, 'reason', 'fixture_pre_migration_stub',
    'opportunity_id', p_opportunity_id,
    'concept_overall_score', p_concept_overall_score
  )
$function$;
-- CREATE OR REPLACE preserves ACLs; explicitly restore the fixture's original
-- default PUBLIC EXECUTE grant after the candidate migration narrowed it.
revoke all on function public.taleforge_check_autonomous_creation_gate(uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.taleforge_check_autonomous_creation_gate(uuid, numeric) to public;

revoke all privileges on table public.release_schedules from public, anon, authenticated, service_role;
grant all privileges on table public.release_schedules to anon, authenticated, service_role;
grant select (id), update (auto_publish) on table public.release_schedules to anon, authenticated;

commit;
