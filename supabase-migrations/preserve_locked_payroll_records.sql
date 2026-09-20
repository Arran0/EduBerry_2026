-- ============================================================
-- Migration: Preserve locked pay-cycle records
--
-- A locked salary cycle is meant to be history: what was actually paid,
-- fixed at the moment it was locked. Two things were undermining that:
--
--   1. salary_records.staff_id / support_staff_id used ON DELETE CASCADE.
--      Deleting a staff/support-staff account outright (as opposed to
--      resigning/banning them, which only flips a flag) removed every
--      salary_records row for them along with it — including rows in
--      cycles that had already been locked. A locked month's payroll
--      history should not depend on the account it was paid to still
--      existing.
--
--   2. Nothing snapshotted who a record was for, or what its
--      attendance-derived Working Days / Leave / Late / Half Day / bonus
--      point counts were, at the moment the cycle was locked. The app layer
--      (see src/app/more/salary/manage/[cycleId]/page.tsx) recomputed those
--      live from current attendance on every load, closed cycle or not, so
--      a later change to attendance, a holiday, or the payroll calibration
--      quietly moved figures that were supposed to be fixed once locked.
--
-- This migration only adds the storage this preservation needs; the app
-- layer change that actually freezes these columns when a cycle is locked
-- ships alongside it.
-- Safe to re-run.
-- ============================================================

-- ── Snapshot columns ─────────────────────────────────────────
-- Populated once, by the app, at the moment a cycle is locked. NULL means
-- either the cycle has never been locked, or it was locked before this
-- migration shipped — in both cases the existing live-computed fallback
-- keeps working exactly as before.

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS person_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS person_role_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS working_days_snapshot SMALLINT,
  ADD COLUMN IF NOT EXISTS leave_snapshot SMALLINT,
  ADD COLUMN IF NOT EXISTS late_snapshot SMALLINT,
  ADD COLUMN IF NOT EXISTS half_day_snapshot SMALLINT,
  ADD COLUMN IF NOT EXISTS bonus_points_snapshot INTEGER;

-- ── Stop cascading the delete ────────────────────────────────
-- Drop whatever the staff_id / support_staff_id foreign keys are currently
-- named (found via information_schema rather than assumed, since they were
-- added across two migrations — add_salary_manager.sql and
-- add_support_staff_salary.sql — with Postgres's default naming) and
-- recreate both as ON DELETE SET NULL. The row survives; from that point on
-- it is identified by the snapshot columns above instead of a live join.

DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'salary_records'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name IN ('staff_id', 'support_staff_id')
  LOOP
    EXECUTE format('ALTER TABLE public.salary_records DROP CONSTRAINT %I', con.constraint_name);
  END LOOP;
END$$;

ALTER TABLE public.salary_records
  ADD CONSTRAINT salary_records_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.salary_records
  ADD CONSTRAINT salary_records_support_staff_id_fkey
  FOREIGN KEY (support_staff_id) REFERENCES public.support_staff(id) ON DELETE SET NULL;

-- The original check (added in add_support_staff_salary.sql) required
-- *exactly* one of staff_id / support_staff_id to be set. A hard-deleted
-- person now leaves both null instead of cascading the row away, so relax
-- it to "at most one" — it still blocks a row ever claiming to be both a
-- staff member and a support staff member at once.

ALTER TABLE public.salary_records DROP CONSTRAINT IF EXISTS salary_records_person_check;
ALTER TABLE public.salary_records ADD CONSTRAINT salary_records_person_check
  CHECK (NOT (staff_id IS NOT NULL AND support_staff_id IS NOT NULL));

NOTIFY pgrst, 'reload schema';
