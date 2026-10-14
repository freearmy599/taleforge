\set ON_ERROR_STOP on

-- Table and identity-sequence grants must be narrow for client roles.
DO $event_uuid_index_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.reader_events'::regclass
      AND attname = 'event_uuid' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: event_uuid column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'reader_events'
      AND indexname = 'reader_events_event_uuid_uidx'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: reader event idempotency index missing';
  END IF;
END;
$event_uuid_index_assert$;

DO $acl_assert$
BEGIN
  IF NOT has_table_privilege('anon','public.reader_events','INSERT')
     OR has_table_privilege('anon','public.reader_events','SELECT')
     OR has_table_privilege('anon','public.reader_events','UPDATE')
     OR has_table_privilege('anon','public.reader_events','DELETE')
     OR has_table_privilege('anon','public.reader_events','TRUNCATE')
     OR has_table_privilege('anon','public.reader_events','REFERENCES')
     OR has_table_privilege('anon','public.reader_events','TRIGGER') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: anon reader_events privileges are not INSERT-only';
  END IF;
  IF NOT has_table_privilege('authenticated','public.reader_events','INSERT')
     OR has_table_privilege('authenticated','public.reader_events','SELECT')
     OR has_table_privilege('authenticated','public.reader_events','UPDATE')
     OR has_table_privilege('authenticated','public.reader_events','DELETE')
     OR has_table_privilege('authenticated','public.reader_events','TRUNCATE')
     OR has_table_privilege('authenticated','public.reader_events','REFERENCES')
     OR has_table_privilege('authenticated','public.reader_events','TRIGGER') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated reader_events privileges are not INSERT-only';
  END IF;
  IF has_sequence_privilege('anon','public.reader_events_id_seq','USAGE')
     OR has_sequence_privilege('anon','public.reader_events_id_seq','SELECT')
     OR has_sequence_privilege('authenticated','public.reader_events_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.reader_events_id_seq','SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: clients retain direct reader identity-sequence access';
  END IF;
  IF NOT has_table_privilege('service_role','public.reader_events','INSERT')
     OR NOT has_table_privilege('service_role','public.reader_events','SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role access was not preserved';
  END IF;
END;
$acl_assert$;

-- The insert policy must enforce the exact chapter/series pair, not merely two
-- individually valid foreign keys.
SET ROLE anon;

INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id,event_uuid)
VALUES ('visitor-valid-anon-0001','story_open',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000111',
        '10000000-0000-0000-0000-000000000001');

DO $duplicate_event_uuid_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id,event_uuid)
    VALUES ('visitor-valid-anon-0001','story_open',
            '00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000111',
            '10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'ASSERTION_FAILED: duplicate event UUID was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$duplicate_event_uuid_assert$;

DO $mismatched_pair_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('visitor-mismatch-0001','chapter_start',
            '00000000-0000-0000-0000-000000000102',
            '00000000-0000-0000-0000-000000000111');
    RAISE EXCEPTION 'ASSERTION_FAILED: mismatched chapter/series pair was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$mismatched_pair_assert$;

DO $event_without_series_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('visitor-no-series-0002','story_open',NULL,NULL);
    RAISE EXCEPTION 'ASSERTION_FAILED: event without a series was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$event_without_series_assert$;

DO $chapter_without_series_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('visitor-no-series-0001','chapter_start',NULL,
            '00000000-0000-0000-0000-000000000111');
    RAISE EXCEPTION 'ASSERTION_FAILED: chapter event without series was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$chapter_without_series_assert$;

DO $unpublished_chapter_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('visitor-unpublished-0001','chapter_start',
            '00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000112');
    RAISE EXCEPTION 'ASSERTION_FAILED: unpublished chapter event was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$unpublished_chapter_assert$;

DO $ineligible_series_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('visitor-ineligible-0001','story_open',
            '00000000-0000-0000-0000-000000000103',NULL);
    RAISE EXCEPTION 'ASSERTION_FAILED: ineligible series event was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$ineligible_series_assert$;

DO $visitor_length_assert$
BEGIN
  BEGIN
    INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
    VALUES ('short','story_open',
            '00000000-0000-0000-0000-000000000101',NULL);
    RAISE EXCEPTION 'ASSERTION_FAILED: undersized visitor id was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$visitor_length_assert$;

INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
VALUES ('visitor-series-only-0001','story_open',
        '00000000-0000-0000-0000-000000000101',NULL);

INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
VALUES ('visitor-completed-0001','chapter_complete',
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-000000000141');

RESET ROLE;
SET ROLE authenticated;
INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id)
VALUES ('visitor-valid-auth-0001','chapter_start',
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000121');
RESET ROLE;

DO $row_count_assert$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.reader_events;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: expected four accepted events, found %', v_count;
  END IF;
  IF has_table_privilege('anon','public.reader_events','SELECT')
     OR has_table_privilege('authenticated','public.reader_events','SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: raw reader event SELECT became available';
  END IF;
END;
$row_count_assert$;

SELECT 'reader event integrity and INSERT-only migration assertions passed' AS result;
