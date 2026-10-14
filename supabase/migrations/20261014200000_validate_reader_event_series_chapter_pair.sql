-- Tighten public reader-event validation so a chapter event cannot be attributed
-- to a different series or omit its parent series. Keep the intake write-only;
-- this policy does not attempt to solve event replay or volume abuse.
DROP POLICY IF EXISTS "Public can record reader events" ON public.reader_events;

CREATE POLICY "Public can record reader events"
ON public.reader_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  visitor_id IS NOT NULL
  AND length(visitor_id) >= 16
  AND length(visitor_id) <= 100
  AND (
    series_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.series AS s
      WHERE s.id = reader_events.series_id
        AND s.status IN ('ongoing', 'completed')
    )
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
