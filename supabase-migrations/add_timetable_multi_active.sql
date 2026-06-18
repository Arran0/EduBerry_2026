-- ============================================================
-- Migration: Allow multiple active timetable configs
--
-- Previously exactly one config could have is_active = true at a
-- time; setActiveConfig() cleared all others.  This migration
-- lifts that restriction so different sections of the school can
-- run independent timetable configurations simultaneously.
--
-- Changes:
--   1. Tighten student RLS on timetables + timetable_entries so
--      students only see entries from configs that are BOTH
--      published AND is_active = true.
--   2. Add a partial index on timetable_configs(is_active) to
--      keep those cross-table EXISTS checks fast.
--
-- No schema (table/column) changes — only policy replacements.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── timetables ───────────────────────────────────────────────

-- Drop the old policy that let students see any published timetable
-- regardless of whether its config is still active.
DROP POLICY IF EXISTS "Students can view published timetables" ON public.timetables;

-- Students now see a published timetable only when its parent
-- config is also marked active.
CREATE POLICY "Students can view published timetables"
  ON public.timetables FOR SELECT
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.timetable_configs c
      WHERE c.id = timetables.config_id
        AND c.is_active = true
    )
  );

-- ── timetable_entries ────────────────────────────────────────

-- Drop the old student entry policy.
DROP POLICY IF EXISTS "Students can view own class published entries" ON public.timetable_entries;

-- Students see entries only when:
--   • the entry belongs to a published timetable
--   • whose config is active
--   • AND the entry's homeroom contains the student
CREATE POLICY "Students can view own class published entries"
  ON public.timetable_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.timetables t
      JOIN public.timetable_configs c ON c.id = t.config_id
      WHERE t.id = timetable_entries.timetable_id
        AND t.status = 'published'
        AND c.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.homeroom_members hm
      WHERE hm.homeroom_id = timetable_entries.homeroom_id
        AND hm.student_id = auth.uid()
    )
  );

-- ── Index ────────────────────────────────────────────────────

-- Partial index — only active configs are indexed, keeping it tiny.
CREATE INDEX IF NOT EXISTS idx_configs_active
  ON public.timetable_configs(id) WHERE is_active = true;

NOTIFY pgrst, 'reload schema';
