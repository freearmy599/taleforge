\\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$roles$;

CREATE TABLE public.release_schedules (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL UNIQUE,
  next_release_at timestamptz,
  last_release_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.story_lifecycle (
  series_id uuid PRIMARY KEY,
  lifecycle_status text NOT NULL,
  last_lifecycle_review_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.release_schedules(id, series_id) VALUES
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
INSERT INTO public.story_lifecycle(series_id,lifecycle_status) VALUES
('00000000-0000-0000-0000-000000000001','preparing'),
('00000000-0000-0000-0000-000000000002','preparing');
