-- ============================================================
-- Migration: Multiple coordinators per teacher team
--   * teams.coordinator_id was a single nullable FK — a team could
--     have at most one coordinator. This introduces team_coordinators,
--     a join table (mirroring team_members) that allows any number of
--     coordinators per team.
--   * Every read/write path that assumed a single coordinator is
--     migrated to the join table in this same migration:
--       - my_teammate_ids() / shares_team_with() (staff attendance RLS)
--       - can_manage_exam() (coordinator exam management)
--       - handle_profile_delete() (profile-delete cleanup trigger)
--   * teams.coordinator_id is dropped at the end, once every consumer
--     has moved to team_coordinators.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.team_coordinators (
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_coordinators_team_id ON public.team_coordinators(team_id);
CREATE INDEX IF NOT EXISTS idx_team_coordinators_user_id ON public.team_coordinators(user_id);

ALTER TABLE public.team_coordinators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team coordinators viewable by authenticated" ON public.team_coordinators
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Team coordinators manageable by admin" ON public.team_coordinators
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Backfill from the existing single-coordinator column.
INSERT INTO public.team_coordinators (team_id, user_id)
SELECT id, coordinator_id FROM public.teams WHERE coordinator_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── my_teammate_ids(): currently-active function behind the staff
--    attendance RLS policies (see optimize_shares_team_with.sql) ──
CREATE OR REPLACE FUNCTION public.my_teammate_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH my_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = auth.uid()
    UNION
    SELECT team_id FROM public.team_coordinators WHERE user_id = auth.uid()
  )
  SELECT tm.user_id
  FROM public.team_members tm
  JOIN my_teams mt ON tm.team_id = mt.team_id
  UNION
  SELECT tc.user_id
  FROM public.team_coordinators tc
  JOIN my_teams mt ON tc.team_id = mt.team_id;
$$;

-- ── shares_team_with(): superseded by my_teammate_ids() for the staff
--    attendance policies, but kept correct since it's still granted to
--    anon/authenticated and may be called directly. ──
CREATE OR REPLACE FUNCTION public.shares_team_with(viewer UUID, target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = viewer
    UNION
    SELECT team_id FROM public.team_coordinators WHERE user_id = viewer
  ),
  target_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = target
    UNION
    SELECT team_id FROM public.team_coordinators WHERE user_id = target
  )
  SELECT EXISTS (
    SELECT 1 FROM viewer_teams v JOIN target_teams t ON v.team_id = t.team_id
  );
$$;

-- ── can_manage_exam(): a coordinator can manage exams created by any
--    member of any team they coordinate, not just the one team that
--    used to name them as coordinator_id. ──
CREATE OR REPLACE FUNCTION public.can_manage_exam(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.exams e WHERE e.id = p_exam_id AND e.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.exam_graders g WHERE g.exam_id = p_exam_id AND g.teacher_id = auth.uid())
    OR public.get_user_role() IN ('admin','principal')
    OR (
      public.get_user_role() = 'coordinator'
      AND EXISTS (
        SELECT 1
        FROM public.exams e
        JOIN public.team_members tm ON tm.user_id = e.created_by
        JOIN public.team_coordinators tc ON tc.team_id = tm.team_id
        WHERE e.id = p_exam_id AND tc.user_id = auth.uid()
      )
    );
$$;

-- ── handle_profile_delete(): drop the coordinator_id nullify step —
--    team_coordinators rows for the deleted user cascade on their own. ──
CREATE OR REPLACE FUNCTION public.handle_profile_delete()
RETURNS TRIGGER AS $$
DECLARE
  fallback_id UUID;
BEGIN
  SELECT id INTO fallback_id
  FROM public.profiles
  WHERE role = 'admin' AND id != OLD.id
  ORDER BY created_at
  LIMIT 1;

  -- Tasks the deleted user created are removed rather than handed to
  -- admin — cascades to their task_assignees / task_checklist_items /
  -- task_comments.
  DELETE FROM public.tasks WHERE created_by = OLD.id;

  IF fallback_id IS NOT NULL THEN
    UPDATE public.task_comments     SET user_id    = fallback_id WHERE user_id    = OLD.id;
    UPDATE public.projects          SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.announcements     SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classrooms        SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_folders SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_files   SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_assessments SET created_by = fallback_id WHERE created_by = OLD.id;
  END IF;

  -- Clear nullable FK columns that have no ON DELETE action.
  UPDATE public.subtasks  SET assignee_id  = NULL WHERE assignee_id  = OLD.id;
  UPDATE public.subtasks  SET created_by   = NULL WHERE created_by   = OLD.id;
  UPDATE public.feedbacks SET replied_by   = NULL WHERE replied_by   = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Drop the now-superseded single-coordinator column ──
DROP INDEX IF EXISTS idx_teams_coordinator_id;
ALTER TABLE public.teams DROP COLUMN IF EXISTS coordinator_id;

NOTIFY pgrst, 'reload schema';
