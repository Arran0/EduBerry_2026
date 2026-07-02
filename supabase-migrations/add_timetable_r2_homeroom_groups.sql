-- ============================================================
-- Migration: Timetable Round 2 — homeroom groups
--
-- Lets a homeroom be divided into named groups. A group is either
-- subject-filtered (e.g. "Biology students" vs "Computer students")
-- or custom-named. Students are added to a group individually
-- (by email in the UI, by id here). Groups become the targeting
-- unit for split classes in a later round.
--
-- RLS mirrors the existing timetable tables: staff read, admin
-- write, students read their own memberships. Run in the Supabase
-- SQL Editor.
-- ============================================================

-- ── Enum ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.homeroom_group_kind AS ENUM ('subject', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── timetable_homeroom_groups ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_homeroom_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  kind public.homeroom_group_kind NOT NULL DEFAULT 'custom',
  subject_id UUID REFERENCES public.timetable_subjects(id) ON DELETE SET NULL,
  color TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_homeroom_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view homeroom groups"
  ON public.timetable_homeroom_groups FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert homeroom groups"
  ON public.timetable_homeroom_groups FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update homeroom groups"
  ON public.timetable_homeroom_groups FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete homeroom groups"
  ON public.timetable_homeroom_groups FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_homeroom_groups_homeroom
  ON public.timetable_homeroom_groups(homeroom_id);

CREATE TRIGGER timetable_homeroom_groups_updated_at
  BEFORE UPDATE ON public.timetable_homeroom_groups
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_group_members ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.timetable_homeroom_groups(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, student_id)
);

ALTER TABLE public.timetable_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view group members"
  ON public.timetable_group_members FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Students can view own group memberships"
  ON public.timetable_group_members FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Admin can insert group members"
  ON public.timetable_group_members FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete group members"
  ON public.timetable_group_members FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_group_members_group
  ON public.timetable_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_student
  ON public.timetable_group_members(student_id);

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
