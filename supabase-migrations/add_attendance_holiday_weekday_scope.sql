-- ============================================================================
-- Weekly-recurring holidays — a Holiday could previously only be declared for
-- one exact date, so a standing weekly off (Sunday) had to be re-entered every
-- single week forever. Nobody was doing that, so every unmarked Sunday was
-- silently scored as an unpaid absence in payroll for every staff member,
-- every month.
--
-- This generalises attendance_holidays the same way attendance_day_timings
-- already splits Late/Checkout cutoffs into 'date' vs 'weekday' scope
-- (see upgrade_staff_attendance.sql / add_timing... — attendance_day_timings):
--   * scope_type = 'date'    → the existing behaviour, one exact date
--   * scope_type = 'weekday' → repeats every week on that weekday (0=Sunday..6=Saturday)
--
-- The old `date` column is renamed to `scope_date` for the same naming as
-- attendance_day_timings.scope_date/scope_weekday. Only 2 rows exist in
-- production at the time of writing, so this is a low-risk rename.
--
-- Run this in the Supabase SQL Editor AFTER upgrade_attendance_holidays_groups.sql.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.attendance_holidays RENAME COLUMN date TO scope_date;
ALTER TABLE public.attendance_holidays ALTER COLUMN scope_date DROP NOT NULL;

ALTER TABLE public.attendance_holidays
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'date' CHECK (scope_type IN ('date', 'weekday')),
  ADD COLUMN IF NOT EXISTS scope_weekday SMALLINT CHECK (scope_weekday BETWEEN 0 AND 6);

-- Every existing row is a 'date' rule (the default above), so scope_date stays
-- populated for all of them and this backfill is a no-op beyond documenting intent.
UPDATE public.attendance_holidays SET scope_type = 'date' WHERE scope_type IS NULL;

-- Replace the old "one default per date" unique index with one scoped to each
-- rule kind: one default 'date' row per date, one default 'weekday' row per weekday.
DROP INDEX IF EXISTS idx_attendance_holidays_one_default;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_holidays_one_default_date
  ON public.attendance_holidays(scope_date) WHERE is_default AND scope_type = 'date';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_holidays_one_default_weekday
  ON public.attendance_holidays(scope_weekday) WHERE is_default AND scope_type = 'weekday';

DROP INDEX IF EXISTS idx_attendance_holidays_date_lookup;
CREATE INDEX IF NOT EXISTS idx_attendance_holidays_date_lookup ON public.attendance_holidays(scope_date);
CREATE INDEX IF NOT EXISTS idx_attendance_holidays_weekday_lookup ON public.attendance_holidays(scope_weekday);

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
