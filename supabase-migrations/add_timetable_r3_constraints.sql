-- ============================================================
-- Migration: Timetable Round 3 — unified constraints framework
--
-- One polymorphic table captures every scheduling constraint the
-- app supports, for teachers, homerooms, subjects, groups, and the
-- pin-the-class-teacher rule:
--   * time_off              (+ day, slot_id)
--   * min/max_per_day       (+ value)
--   * min/max_per_week      (+ value)
--   * max_in_a_row          (+ value, teachers)
--   * pin_class_teacher     (+ day, slot_id) — the class teacher
--                             must teach her homeroom at this slot
--
-- scope_id NULL means "all" of that scope (e.g. all teachers).
-- homeroom_id optionally narrows a min/max rule to one homeroom.
--
-- Existing teacher_unavailability rows are copied in as teacher
-- time_off so the new Constraints tab is the single source of truth.
-- The old table is kept for back-compat but no longer edited.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.constraint_scope AS ENUM (
    'teacher', 'homeroom', 'subject', 'group', 'class_teacher'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.constraint_type AS ENUM (
    'time_off', 'min_per_day', 'max_per_day',
    'min_per_week', 'max_per_week', 'max_in_a_row', 'pin_class_teacher'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── timetable_constraints ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_constraints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  scope public.constraint_scope NOT NULL,
  scope_id UUID,                                   -- NULL = all of that scope
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE,
  type public.constraint_type NOT NULL,
  value SMALLINT,
  day TEXT CHECK (day IS NULL OR day IN
    ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  slot_id UUID REFERENCES public.timetable_period_slots(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view constraints"
  ON public.timetable_constraints FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert constraints"
  ON public.timetable_constraints FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update constraints"
  ON public.timetable_constraints FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete constraints"
  ON public.timetable_constraints FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_constraints_config ON public.timetable_constraints(config_id);
CREATE INDEX IF NOT EXISTS idx_constraints_scope ON public.timetable_constraints(scope, scope_id);

CREATE TRIGGER timetable_constraints_updated_at
  BEFORE UPDATE ON public.timetable_constraints
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Migrate existing teacher unavailability → time_off ───────

INSERT INTO public.timetable_constraints (config_id, scope, scope_id, type, day, slot_id)
SELECT config_id, 'teacher', teacher_id, 'time_off', day, slot_id
FROM public.teacher_unavailability;

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
