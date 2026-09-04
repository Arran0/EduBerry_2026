-- ============================================================
-- Migration: Timetable Round 8 — several teachers per session
--
-- A lesson can be taught by more than one teacher (co-teaching, a
-- lab assistant, a language pair). This applies to
--
--   * requirements       — whole-class AND per-group (split) rows
--   * combined classes   — the shared lesson several homerooms attend
--   * entries            — the generated/edited period itself
--
-- The existing single `teacher_id` column stays as the PRIMARY teacher
-- (first in the list) so every existing query, RLS policy and view keeps
-- working; `teacher_ids` carries the full list including that primary.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── Requirements ─────────────────────────────────────────────

ALTER TABLE public.timetable_requirements
  ADD COLUMN IF NOT EXISTS teacher_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.timetable_requirements
   SET teacher_ids = ARRAY[teacher_id]
 WHERE teacher_id IS NOT NULL
   AND (teacher_ids IS NULL OR cardinality(teacher_ids) = 0);

CREATE INDEX IF NOT EXISTS idx_requirements_teacher_ids
  ON public.timetable_requirements USING GIN (teacher_ids);

-- ── Combined classes ─────────────────────────────────────────

ALTER TABLE public.timetable_combined_classes
  ADD COLUMN IF NOT EXISTS teacher_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.timetable_combined_classes
   SET teacher_ids = ARRAY[teacher_id]
 WHERE teacher_id IS NOT NULL
   AND (teacher_ids IS NULL OR cardinality(teacher_ids) = 0);

CREATE INDEX IF NOT EXISTS idx_combined_teacher_ids
  ON public.timetable_combined_classes USING GIN (teacher_ids);

-- ── Entries ──────────────────────────────────────────────────
-- teacher_names mirrors the denormalised teacher_name column so students
-- (who cannot read staff profiles through RLS) still see every teacher.

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS teacher_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS teacher_names TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.timetable_entries
   SET teacher_ids = ARRAY[teacher_id]
 WHERE teacher_id IS NOT NULL
   AND (teacher_ids IS NULL OR cardinality(teacher_ids) = 0);

UPDATE public.timetable_entries
   SET teacher_names = ARRAY[teacher_name]
 WHERE teacher_name IS NOT NULL
   AND (teacher_names IS NULL OR cardinality(teacher_names) = 0);

-- Staff timetables are read with `teacher_id = me OR teacher_ids @> {me}`.
CREATE INDEX IF NOT EXISTS idx_entries_teacher_ids
  ON public.timetable_entries USING GIN (teacher_ids);

NOTIFY pgrst, 'reload schema';
