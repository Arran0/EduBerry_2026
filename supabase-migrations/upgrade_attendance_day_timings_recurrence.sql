-- ============================================================
-- Migration: Weekly-recurring scope for attendance_day_timings
--   Extends the one-off per-date late/checkout cutoff overrides
--   added in add_attendance_day_timings.sql to also support
--   repeating weekly rules (e.g. "every Saturday").
--
--   attendance_day_timings.date -> scope_date (nullable now), plus
--   new scope_type ('date' | 'weekday') and scope_weekday (0=Sun..6=Sat)
--   columns. Existing rows are backfilled as scope_type = 'date'.
--
-- Run this in the Supabase SQL Editor AFTER add_attendance_day_timings.sql.
-- Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_day_timings' AND column_name = 'date'
  ) THEN
    ALTER TABLE public.attendance_day_timings RENAME COLUMN date TO scope_date;
  END IF;
END $$;

ALTER TABLE public.attendance_day_timings ALTER COLUMN scope_date DROP NOT NULL;

ALTER TABLE public.attendance_day_timings
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'date',
  ADD COLUMN IF NOT EXISTS scope_weekday SMALLINT;

ALTER TABLE public.attendance_day_timings DROP CONSTRAINT IF EXISTS attendance_day_timings_scope_type_check;
ALTER TABLE public.attendance_day_timings
  ADD CONSTRAINT attendance_day_timings_scope_type_check CHECK (scope_type IN ('date', 'weekday'));

ALTER TABLE public.attendance_day_timings DROP CONSTRAINT IF EXISTS attendance_day_timings_scope_check;
ALTER TABLE public.attendance_day_timings
  ADD CONSTRAINT attendance_day_timings_scope_check CHECK (
    (scope_type = 'date' AND scope_date IS NOT NULL AND scope_weekday IS NULL) OR
    (scope_type = 'weekday' AND scope_weekday BETWEEN 0 AND 6 AND scope_date IS NULL)
  );

DROP INDEX IF EXISTS idx_attendance_day_timings_one_default;
DROP INDEX IF EXISTS idx_attendance_day_timings_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_day_timings_one_default_date
  ON public.attendance_day_timings(scope_date) WHERE is_default AND scope_type = 'date';
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_day_timings_one_default_weekday
  ON public.attendance_day_timings(scope_weekday) WHERE is_default AND scope_type = 'weekday';

CREATE INDEX IF NOT EXISTS idx_attendance_day_timings_scope_date ON public.attendance_day_timings(scope_date);
CREATE INDEX IF NOT EXISTS idx_attendance_day_timings_scope_weekday ON public.attendance_day_timings(scope_weekday);

NOTIFY pgrst, 'reload schema';
