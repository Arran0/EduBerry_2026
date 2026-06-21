-- ============================================================
-- Migration: Smart Board tasks (Phase 2, Round 1)
--
-- A smart board can type tasks straight onto its weekly calendar and
-- link each one to a classroom it belongs to. Every homeroom member
-- then sees the task reflected on their own calendar and reports a
-- completion / submission against it.
--
-- These tasks are intentionally SEPARATE from classroom_files: a board
-- task linked to a classroom does NOT appear inside that classroom.
--
-- Run this in the Supabase SQL Editor (after add_smartboard_role.sql).
-- ============================================================

-- ── smartboard_tasks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.smartboard_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homeroom_id  UUID NOT NULL REFERENCES public.homerooms(id) ON DELETE CASCADE,
  -- Which classroom the task is "from". NULL = a general homeroom task.
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  due_date     DATE,
  timing       TEXT,            -- start "HH:MM" (matches tasks.timing)
  end_time     TEXT,            -- end   "HH:MM"
  edu_points   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smartboard_tasks_homeroom  ON public.smartboard_tasks(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_smartboard_tasks_classroom ON public.smartboard_tasks(classroom_id);
CREATE INDEX IF NOT EXISTS idx_smartboard_tasks_due_date  ON public.smartboard_tasks(due_date);

-- ── smartboard_task_completions ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.smartboard_task_completions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.smartboard_tasks(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'not_done'
              CHECK (status IN ('not_done', 'partial', 'done', 'checked')),
  submission  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_sb_task_completions_task    ON public.smartboard_task_completions(task_id);
CREATE INDEX IF NOT EXISTS idx_sb_task_completions_student ON public.smartboard_task_completions(student_id);

-- ── Helper: is the caller the smart board that owns this homeroom? ──
CREATE OR REPLACE FUNCTION public.is_homeroom_smartboard(p_homeroom_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM homerooms
    WHERE id = p_homeroom_id AND smartboard_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_homeroom_smartboard(UUID) TO authenticated;

-- ── Helper: is the caller a member (student) of this homeroom? ──
CREATE OR REPLACE FUNCTION public.is_homeroom_member(p_homeroom_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM homeroom_members
    WHERE homeroom_id = p_homeroom_id AND student_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_homeroom_member(UUID) TO authenticated;

-- ── RLS: smartboard_tasks ────────────────────────────────────
ALTER TABLE public.smartboard_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smartboard_tasks_select ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_select ON public.smartboard_tasks
  FOR SELECT USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.is_homeroom_member(homeroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_insert ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_insert ON public.smartboard_tasks
  FOR INSERT WITH CHECK (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_update ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_update ON public.smartboard_tasks
  FOR UPDATE USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_delete ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_delete ON public.smartboard_tasks
  FOR DELETE USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

-- ── RLS: smartboard_task_completions ─────────────────────────
ALTER TABLE public.smartboard_task_completions ENABLE ROW LEVEL SECURITY;

-- A board owns a completion when it owns the task's homeroom.
DROP POLICY IF EXISTS sb_completions_select ON public.smartboard_task_completions;
CREATE POLICY sb_completions_select ON public.smartboard_task_completions
  FOR SELECT USING (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id AND public.is_homeroom_smartboard(t.homeroom_id)
    )
  );

-- Students report their own progress; boards/staff can verify (set 'checked').
DROP POLICY IF EXISTS sb_completions_insert ON public.smartboard_task_completions;
CREATE POLICY sb_completions_insert ON public.smartboard_task_completions
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id AND public.is_homeroom_smartboard(t.homeroom_id)
    )
  );

DROP POLICY IF EXISTS sb_completions_update ON public.smartboard_task_completions;
CREATE POLICY sb_completions_update ON public.smartboard_task_completions
  FOR UPDATE USING (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id AND public.is_homeroom_smartboard(t.homeroom_id)
    )
  );

-- ── RPC: get_classroom_edu_top3 ──────────────────────────────
-- Top 3 students by derived EduPoints in a classroom (points count once a
-- classroom_file reaches 'completed'). SECURITY DEFINER so a board/staff can
-- read across all students. Callable by classroom members and staff.
CREATE OR REPLACE FUNCTION public.get_classroom_edu_top3(p_classroom_id UUID)
RETURNS TABLE (
  student_id UUID,
  full_name  TEXT,
  avatar_url TEXT,
  points     INTEGER,
  rank       INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
        SELECT 1 FROM classroom_members
        WHERE classroom_id = p_classroom_id AND user_id = auth.uid()
      )
     AND public.get_user_role() NOT IN ('teacher', 'coordinator', 'principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH pts AS (
    SELECT cm.user_id AS student_id,
           COALESCE(SUM(CASE WHEN pr.status = 'completed' THEN cf.edu_points ELSE 0 END), 0) AS points
    FROM classroom_members cm
    LEFT JOIN classroom_folders fo ON fo.classroom_id = cm.classroom_id
    LEFT JOIN classroom_files cf   ON cf.folder_id = fo.id
    LEFT JOIN classroom_file_progress pr ON pr.file_id = cf.id AND pr.student_id = cm.user_id
    WHERE cm.classroom_id = p_classroom_id AND cm.role = 'student'
    GROUP BY cm.user_id
  ),
  ranked AS (
    SELECT pts.student_id, pts.points,
           RANK() OVER (ORDER BY pts.points DESC) AS rnk
    FROM pts
  )
  SELECT r.student_id, pf.full_name, pf.avatar_url, r.points::INTEGER, r.rnk::INTEGER
  FROM ranked r
  JOIN profiles pf ON pf.id = r.student_id
  WHERE r.rnk <= 3 AND r.points > 0
  ORDER BY r.rnk, pf.full_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_classroom_edu_top3(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
