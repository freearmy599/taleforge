-- Enforce semantic relationship integrity for public reader-event intake.
-- A supplied chapter must belong to the supplied eligible series and be published.
-- Series-only events remain valid. This is branch-only and must be tested in an
-- isolated database before production rollout.
DROP POLICY IF EXISTS "Public can record reader events" ON public.reader_events;

CREATE POLICY "Public can record reader events"
ON public.reader_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  visitor_id IS NOT NULL
  AND length(visitor_id) BETWEEN 16 AND 100
  AND series_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.series AS s
    WHERE s.id = reader_events.series_id
      AND s.status IN ('ongoing', 'completed')
  )
  AND (
    chapter_id IS NULL
    OR (
      series_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.chapters AS c
        JOIN public.series AS s ON s.id = c.series_id
        WHERE c.id = reader_events.chapter_id
          AND c.series_id = reader_events.series_id
          AND c.status = 'published'
          AND s.status IN ('ongoing', 'completed')
      )
    )
  )
);
