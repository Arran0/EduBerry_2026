-- ============================================================
-- Migration: Timetable Round 4 — consecutive-period blocks
--
-- Adds min_block / max_block to timetable_requirements so a subject
-- can require its periods to be scheduled in contiguous blocks
-- (e.g. a lab or PE needing a double or triple period with no break
-- in between). min_block = max_block = 1 (the default) preserves the
-- previous "single period" behaviour.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.timetable_requirements
  ADD COLUMN IF NOT EXISTS min_block SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_block SMALLINT NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
