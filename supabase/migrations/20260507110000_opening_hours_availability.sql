-- =============================================================================
-- Opening hours: 3-state availability (open | closed | unavailable)
-- =============================================================================
-- Today the schema expresses two states via `is_closed boolean`. The /opening-hours
-- page now needs a third state, "unavailable", which means "this service does not
-- run at this time" — distinct from "this service is normally open but is closed
-- right now". Public API behaviour:
--
--   open        → emit open/close times
--   closed      → emit a "closed" status entry (no times)
--   unavailable → omit the entry entirely from the day's services array
--
-- Implementation: add a CHECK-constrained `availability text` column with a
-- default of 'open'. Backfill from the existing `is_closed` boolean. The
-- `is_closed` column is intentionally retained (DROP COLUMN requires explicit
-- approval per workspace rules) and kept in sync by application writes
-- (`is_closed = availability != 'open'`).
-- =============================================================================

-- venue_opening_hours
ALTER TABLE public.venue_opening_hours
  ADD COLUMN IF NOT EXISTS availability text NOT NULL
    DEFAULT 'open'
    CHECK (availability IN ('open', 'closed', 'unavailable'));

UPDATE public.venue_opening_hours
SET availability = CASE WHEN is_closed THEN 'closed' ELSE 'open' END
WHERE availability = 'open' AND is_closed = true;

-- venue_opening_overrides
ALTER TABLE public.venue_opening_overrides
  ADD COLUMN IF NOT EXISTS availability text NOT NULL
    DEFAULT 'open'
    CHECK (availability IN ('open', 'closed', 'unavailable'));

UPDATE public.venue_opening_overrides
SET availability = CASE WHEN is_closed THEN 'closed' ELSE 'open' END
WHERE availability = 'open' AND is_closed = true;

NOTIFY pgrst, 'reload schema';
