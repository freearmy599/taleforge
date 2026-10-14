\set ON_ERROR_STOP on
do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end;
$roles$;

create schema auth;
create function auth.role() returns text
language sql stable
as $$ select coalesce(current_setting('request.jwt.claim.role', true), current_user) $$;

create table public.series (
  id uuid primary key,
  title text not null default 'Fixture series',
  status text not null,
  origin_type text,
  originality_status text
);

create table public.release_schedules (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null unique references public.series(id) on delete cascade,
  enabled boolean not null default false,
  schedule_mode text not null default 'manual',
  interval_hours integer,
  timezone text not null default 'UTC',
  chapters_ahead integer not null default 12,
  auto_generate boolean not null default false,
  auto_publish boolean not null default false,
  next_release_at timestamptz,
  preferred_weekday integer,
  preferred_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.story_lifecycle (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null unique references public.series(id) on delete cascade,
  lifecycle_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.taleforge_autonomous_series_creation_runs (
  id uuid primary key,
  series_id uuid not null references public.series(id) on delete cascade,
  status text not null,
  dry_run boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pipeline_snapshot jsonb not null default '{}'::jsonb
);

create table public.taleforge_autonomous_creation_policy (
  policy_key text primary key,
  enabled boolean not null default false
);

create function public.taleforge_enroll_series_in_production()
returns trigger
language plpgsql
as $function$
begin
  return new;
end;
$function$;

create trigger trg_enroll_series_in_production
after insert or update of status on public.series
for each row execute function public.taleforge_enroll_series_in_production();

-- Simulate a pre-migration legacy schedule that currently has generation enabled.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000001', 'Legacy fixture', 'ongoing', 'ai_original', 'pending');

insert into public.release_schedules(
  id, series_id, enabled, schedule_mode, interval_hours, timezone,
  chapters_ahead, auto_generate, auto_publish, next_release_at
) values (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  true, 'interval', 24, 'Asia/Kolkata', 3, true, false, now()
);

-- A non-manual schedule can be enabled even if both automation flags are false.
-- The readiness migration must still make this unready automatic schedule inert.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000006', 'Enabled interval fixture', 'ongoing', 'ai_original', 'pending');

insert into public.release_schedules(
  id, series_id, enabled, schedule_mode, interval_hours, timezone,
  chapters_ahead, auto_generate, auto_publish, next_release_at
) values (
  '00000000-0000-0000-0000-000000000016',
  '00000000-0000-0000-0000-000000000006',
  true, 'interval', 8, 'UTC', 12, false, false, now()
);
