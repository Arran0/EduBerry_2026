-- ============================================================
-- Migration: Timetable Round 11 — per-date overrides
--
-- Until now a timetable was a pure weekly template: period 3 on a
-- Tuesday was the same lesson on every Tuesday of the year. Schools
-- do not work that way. A teacher is away, a hall is taken, one
-- Tuesday's Maths becomes an exam — and from some Monday onwards a
-- swap becomes permanent.
--
-- timetable_entry_overrides amends ONE cell of the weekly template
-- over a date range:
--
--   effective_from = effective_to  → that date only
--   effective_to IS NULL           → that date and every one after
--
-- kind = 'replace' puts a different subject / teachers / room in the
-- cell; kind = 'cancel' empties it (a free period, an assembly that
-- displaces the lesson).
--
-- The weekly template is never rewritten, so an override can be
-- lifted and the ordinary week comes straight back. `day` is stored
-- alongside slot_id so resolving "what is on screen for 2026-03-04"
-- is an indexed lookup rather than a date-to-weekday join.
--
-- Run in the Supabase SQL Editor (or via the Supabase connection).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timetable_entry_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  -- The published version this amends. NULL = applies whatever version is
  -- live, which is what an admin means by "cover this period from Monday".
  timetable_id UUID REFERENCES public.timetables(id) ON DELETE CASCADE,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  -- The weekday the amended cell sits on. Redundant against slot_id + date,
  -- and that redundancy is the point: resolution stays a plain index scan.
  day TEXT NOT NULL,
  slot_id UUID REFERENCES public.timetable_period_slots(id) ON DELETE CASCADE NOT NULL,
  -- Which lesson layer of the cell: NULL = the whole-class lesson, otherwise
  -- one parallel split group of it.
  group_id UUID REFERENCES public.timetable_homeroom_groups(id) ON DELETE CASCADE,

  effective_from DATE NOT NULL,
  effective_to DATE,

  kind TEXT NOT NULL DEFAULT 'replace' CHECK (kind IN ('replace', 'cancel')),

  subject_id UUID REFERENCES public.timetable_subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  teacher_ids UUID[],
  room_id UUID REFERENCES public.timetable_rooms(id) ON DELETE SET NULL,
  note TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- An open-ended range is allowed; a backwards one is not.
  CONSTRAINT overrides_range_forwards
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- A replacement with nothing to replace it with would silently read as a
  -- cancellation, so the subject is required for that kind and only that kind.
  CONSTRAINT overrides_replace_needs_subject
    CHECK (kind <> 'replace' OR subject_id IS NOT NULL)
);

ALTER TABLE public.timetable_entry_overrides ENABLE ROW LEVEL SECURITY;

-- ── Reads ────────────────────────────────────────────────────
-- Staff see every override. A student sees only the ones that amend their own
-- homeroom, and within a split class only their own group's layer — the same
-- rule timetable_entries is scoped by, kept server-side rather than in the
-- fetch so it cannot be stepped around via PostgREST.

DROP POLICY IF EXISTS "Staff and own students can view overrides" ON public.timetable_entry_overrides;
CREATE POLICY "Staff and own students can view overrides"
  ON public.timetable_entry_overrides FOR SELECT TO authenticated
  USING (
    ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
    OR (
      EXISTS (
        SELECT 1 FROM public.timetable_configs c
        WHERE c.id = timetable_entry_overrides.config_id
          AND c.is_active = true
      )
      AND EXISTS (
        SELECT 1 FROM public.homeroom_members hm
        WHERE hm.homeroom_id = timetable_entry_overrides.homeroom_id
          AND hm.student_id = (SELECT auth.uid())
      )
      AND (
        timetable_entry_overrides.group_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.timetable_group_members gm
          WHERE gm.group_id = timetable_entry_overrides.group_id
            AND gm.student_id = (SELECT auth.uid())
        )
      )
    )
  );

-- ── Writes ───────────────────────────────────────────────────
-- Admin only, as with every other part of the timetable structure.

DROP POLICY IF EXISTS "Admin can insert overrides" ON public.timetable_entry_overrides;
CREATE POLICY "Admin can insert overrides"
  ON public.timetable_entry_overrides FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can update overrides" ON public.timetable_entry_overrides;
CREATE POLICY "Admin can update overrides"
  ON public.timetable_entry_overrides FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can delete overrides" ON public.timetable_entry_overrides;
CREATE POLICY "Admin can delete overrides"
  ON public.timetable_entry_overrides FOR DELETE
  USING (public.get_user_role() = 'admin');

-- The resolution query: everything amending one class's cell, newest first.
CREATE INDEX IF NOT EXISTS idx_entry_overrides_cell
  ON public.timetable_entry_overrides
  (config_id, homeroom_id, day, slot_id, effective_from DESC);

-- "What is amended for this class at all", for the week views.
CREATE INDEX IF NOT EXISTS idx_entry_overrides_homeroom
  ON public.timetable_entry_overrides(homeroom_id, effective_from DESC);

-- A teacher's cover list is a lookup by who is standing in.
CREATE INDEX IF NOT EXISTS idx_entry_overrides_teacher
  ON public.timetable_entry_overrides(teacher_id)
  WHERE teacher_id IS NOT NULL;

DROP TRIGGER IF EXISTS timetable_entry_overrides_updated_at ON public.timetable_entry_overrides;
CREATE TRIGGER timetable_entry_overrides_updated_at
  BEFORE UPDATE ON public.timetable_entry_overrides
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

NOTIFY pgrst, 'reload schema';
