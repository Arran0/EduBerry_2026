-- ============================================================
-- Migration: Add edu_points to classroom files
-- Staff can attach point values (typically 1-5, custom allowed)
-- to homework/coursework files. Students earn these points when
-- a file reaches the 'completed' state. Totals are derived live
-- (no ledger) from classroom_file_progress.
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.classroom_files
  ADD COLUMN IF NOT EXISTS edu_points INTEGER NOT NULL DEFAULT 0;

-- Reload PostgREST schema cache so the new column is exposed.
NOTIFY pgrst, 'reload schema';
