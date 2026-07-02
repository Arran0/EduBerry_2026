-- ============================================================
-- Migration: Timetable Round 6 — combined classes
--
-- Several homerooms attend one lesson together — one teacher, one
-- room (e.g. Music for 10A + 10B + 10C in the School Hall). A
-- combined class is scheduled once and persists as one entry per
-- member homeroom, all sharing a combined_key.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── Entries: combined key (also declared for Round 5 forward-compat) ─

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS combined_key TEXT;

-- ── timetable_combined_classes ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_combined_classes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject_id UUID REFERENCES public.timetable_subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.timetable_rooms(id) ON DELETE SET NULL,
  periods_per_week SMALLINT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_combined_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view combined classes"
  ON public.timetable_combined_classes FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert combined classes"
  ON public.timetable_combined_classes FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update combined classes"
  ON public.timetable_combined_classes FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete combined classes"
  ON public.timetable_combined_classes FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_combined_config ON public.timetable_combined_classes(config_id);

CREATE TRIGGER timetable_combined_classes_updated_at
  BEFORE UPDATE ON public.timetable_combined_classes
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── timetable_combined_members ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_combined_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  combined_id UUID REFERENCES public.timetable_combined_classes(id) ON DELETE CASCADE NOT NULL,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(combined_id, homeroom_id)
);

ALTER TABLE public.timetable_combined_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view combined members"
  ON public.timetable_combined_members FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert combined members"
  ON public.timetable_combined_members FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete combined members"
  ON public.timetable_combined_members FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_combined_members_combined ON public.timetable_combined_members(combined_id);
CREATE INDEX IF NOT EXISTS idx_combined_members_homeroom ON public.timetable_combined_members(homeroom_id);

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
