-- ============================================================
-- Migration: denormalize teacher name onto timetable entries
-- Students can only read their own profile (RLS), so the joined
-- teacher profile is filtered out on a student's published
-- timetable. Storing the teacher's display name on the entry lets
-- students see who teaches each period without widening profile
-- visibility. Populated by the app when a timetable is saved.
-- Run this in the Supabase SQL Editor (after add_timetable.sql).
-- ============================================================

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS teacher_name TEXT;

NOTIFY pgrst, 'reload schema';
