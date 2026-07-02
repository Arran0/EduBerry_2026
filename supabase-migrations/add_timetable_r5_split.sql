-- ============================================================
-- Migration: Timetable Round 5 — split classes
--
-- A homeroom can run parallel group lessons in the SAME period —
-- e.g. 40 students split into Physics Lab (20) and Chemistry Lab
-- (20), same slot, different teachers and rooms. Groups come from
-- Round 2 (timetable_homeroom_groups).
--
--  * requirements may target a group_id (NULL = whole class)
--  * entries carry group_id + a split_key that ties the parallel
--    entries sharing one homeroom cell together
--
-- The old "one subject per class" and "one entry per cell" unique
-- constraints are widened to include the group.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── Requirements: optional group target ──────────────────────

ALTER TABLE public.timetable_requirements
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES public.timetable_homeroom_groups(id) ON DELETE CASCADE;

-- Widen uniqueness to (config, homeroom, subject, group). Whole-class rows
-- (group_id NULL) collapse to a zero-UUID sentinel so they stay unique.
ALTER TABLE public.timetable_requirements
  DROP CONSTRAINT IF EXISTS timetable_requirements_config_id_homeroom_id_subject_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requirements_config_hr_subj_group
  ON public.timetable_requirements
  (config_id, homeroom_id, subject_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_requirements_group ON public.timetable_requirements(group_id);

-- ── Entries: group + split key ───────────────────────────────

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES public.timetable_homeroom_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_key TEXT;

-- Allow several parallel group entries in one homeroom cell.
ALTER TABLE public.timetable_entries
  DROP CONSTRAINT IF EXISTS timetable_entries_timetable_id_homeroom_id_day_slot_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_cell_group
  ON public.timetable_entries
  (timetable_id, homeroom_id, day, slot_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

NOTIFY pgrst, 'reload schema';
