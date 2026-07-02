-- ============================================================
-- Migration: Timetable Round 1 — class teacher + optional slot timings
--
-- 1. Adds homerooms.class_teacher_id — one class teacher per
--    homeroom (the teacher who "owns" that homeroom).
-- 2. Makes timetable_period_slots.start_time / end_time nullable,
--    so a period can be defined by position/label alone without
--    forcing the admin to enter clock times.
--
-- No RLS changes: homerooms already has an admin UPDATE policy that
-- covers the new column, and the period-slot policies are column-
-- agnostic.  Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Class teacher (one per homeroom) ─────────────────────────

ALTER TABLE public.homerooms
  ADD COLUMN IF NOT EXISTS class_teacher_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homerooms_class_teacher
  ON public.homerooms(class_teacher_id);

-- ── Optional period-slot timings ─────────────────────────────

ALTER TABLE public.timetable_period_slots
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
