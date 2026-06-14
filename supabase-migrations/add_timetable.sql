-- ============================================================
-- Migration: Timetable System
-- Creates the timetable data model: subjects, rooms, configs,
-- period slots, requirements (solver input), teacher
-- unavailability, timetables (versions), and timetable_entries
-- (the generated/published grid) — all with RLS.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE public.room_type AS ENUM (
  'classroom', 'science_lab', 'computer_lab', 'other'
);

CREATE TYPE public.timetable_status AS ENUM (
  'draft', 'published'
);

-- ── timetable_subjects ───────────────────────────────────────
-- Promotes the free-text classrooms.subject into a first-class
-- entity the generator can reason about.

CREATE TABLE public.timetable_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  color TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view subjects"
  ON public.timetable_subjects FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can insert subjects"
  ON public.timetable_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update subjects"
  ON public.timetable_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete subjects"
  ON public.timetable_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE TRIGGER timetable_subjects_updated_at
  BEFORE UPDATE ON public.timetable_subjects
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_rooms ──────────────────────────────────────────

CREATE TABLE public.timetable_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  room_type public.room_type NOT NULL DEFAULT 'classroom',
  capacity SMALLINT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view rooms"
  ON public.timetable_rooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can insert rooms"
  ON public.timetable_rooms FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update rooms"
  ON public.timetable_rooms FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete rooms"
  ON public.timetable_rooms FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE TRIGGER timetable_rooms_updated_at
  BEFORE UPDATE ON public.timetable_rooms
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_configs ────────────────────────────────────────
-- Per academic-year grid shape. working_days holds the active
-- weekdays (e.g. {monday,...,friday}); period slots hang off it.

CREATE TABLE public.timetable_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  academic_year TEXT,
  working_days TEXT[] NOT NULL DEFAULT '{monday,tuesday,wednesday,thursday,friday}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view configs"
  ON public.timetable_configs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can insert configs"
  ON public.timetable_configs FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update configs"
  ON public.timetable_configs FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete configs"
  ON public.timetable_configs FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE TRIGGER timetable_configs_updated_at
  BEFORE UPDATE ON public.timetable_configs
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_period_slots ───────────────────────────────────
-- The rows of the grid for a config. Break/lunch slots
-- (is_break = true) are skipped by the solver.

CREATE TABLE public.timetable_period_slots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  position SMALLINT NOT NULL,
  label TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_break BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, position)
);

ALTER TABLE public.timetable_period_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view period slots"
  ON public.timetable_period_slots FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can insert period slots"
  ON public.timetable_period_slots FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update period slots"
  ON public.timetable_period_slots FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete period slots"
  ON public.timetable_period_slots FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_period_slots_config ON public.timetable_period_slots(config_id);

CREATE TRIGGER timetable_period_slots_updated_at
  BEFORE UPDATE ON public.timetable_period_slots
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_requirements ───────────────────────────────────
-- The solver INPUT: "this homeroom needs this subject N periods
-- per week, taught by this teacher, in this room type".

CREATE TABLE public.timetable_requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.timetable_subjects(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  periods_per_week SMALLINT NOT NULL DEFAULT 1,
  room_type public.room_type NOT NULL DEFAULT 'classroom',
  max_per_day SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, homeroom_id, subject_id)
);

ALTER TABLE public.timetable_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view requirements"
  ON public.timetable_requirements FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert requirements"
  ON public.timetable_requirements FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update requirements"
  ON public.timetable_requirements FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete requirements"
  ON public.timetable_requirements FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_requirements_config ON public.timetable_requirements(config_id);
CREATE INDEX IF NOT EXISTS idx_requirements_homeroom ON public.timetable_requirements(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_requirements_teacher ON public.timetable_requirements(teacher_id);

CREATE TRIGGER timetable_requirements_updated_at
  BEFORE UPDATE ON public.timetable_requirements
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── teacher_unavailability ───────────────────────────────────
-- Hard blocks: a teacher is unavailable on a given day + slot.

CREATE TABLE public.teacher_unavailability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  day TEXT NOT NULL CHECK (day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  slot_id UUID REFERENCES public.timetable_period_slots(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, teacher_id, day, slot_id)
);

ALTER TABLE public.teacher_unavailability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view unavailability"
  ON public.teacher_unavailability FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert unavailability"
  ON public.teacher_unavailability FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update unavailability"
  ON public.teacher_unavailability FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete unavailability"
  ON public.teacher_unavailability FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_unavailability_config ON public.teacher_unavailability(config_id);
CREATE INDEX IF NOT EXISTS idx_unavailability_teacher ON public.teacher_unavailability(teacher_id);

-- ── timetables ───────────────────────────────────────────────
-- A generated/published timetable version. Only status =
-- 'published' rows are visible to students and staff.

CREATE TABLE public.timetables (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  status public.timetable_status NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all timetables"
  ON public.timetables FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Students can view published timetables"
  ON public.timetables FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admin can insert timetables"
  ON public.timetables FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update timetables"
  ON public.timetables FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete timetables"
  ON public.timetables FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_timetables_config ON public.timetables(config_id);
CREATE INDEX IF NOT EXISTS idx_timetables_status ON public.timetables(status);

CREATE TRIGGER timetables_updated_at
  BEFORE UPDATE ON public.timetables
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_entries ────────────────────────────────────────
-- The solver OUTPUT / final grid. One row per occupied cell.

CREATE TABLE public.timetable_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timetable_id UUID REFERENCES public.timetables(id) ON DELETE CASCADE NOT NULL,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  day TEXT NOT NULL CHECK (day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  slot_id UUID REFERENCES public.timetable_period_slots(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.timetable_subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.timetable_rooms(id) ON DELETE SET NULL,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timetable_id, homeroom_id, day, slot_id)
);

ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;

-- Staff (and admins) can see every entry, in any status, for building/review.
CREATE POLICY "Staff can view all timetable entries"
  ON public.timetable_entries FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

-- Students see entries only for PUBLISHED timetables of a homeroom they belong to.
CREATE POLICY "Students can view own class published entries"
  ON public.timetable_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.timetables t
      WHERE t.id = timetable_entries.timetable_id
        AND t.status = 'published'
    )
    AND EXISTS (
      SELECT 1 FROM public.homeroom_members hm
      WHERE hm.homeroom_id = timetable_entries.homeroom_id
        AND hm.student_id = auth.uid()
    )
  );

CREATE POLICY "Admin can insert timetable entries"
  ON public.timetable_entries FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update timetable entries"
  ON public.timetable_entries FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete timetable entries"
  ON public.timetable_entries FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_entries_timetable ON public.timetable_entries(timetable_id);
CREATE INDEX IF NOT EXISTS idx_entries_homeroom ON public.timetable_entries(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_entries_teacher ON public.timetable_entries(teacher_id);
CREATE INDEX IF NOT EXISTS idx_entries_day_slot ON public.timetable_entries(day, slot_id);

CREATE TRIGGER timetable_entries_updated_at
  BEFORE UPDATE ON public.timetable_entries
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
