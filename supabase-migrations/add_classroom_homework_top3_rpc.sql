-- ============================================================
-- Migration: Separate homework EduPoints RPC for classroom top-3
--
-- The existing get_classroom_edu_top3 function counts EduPoints from
-- completed classroom_files. Homework tasks (smartboard_tasks) store
-- their own EduPoints in smartboard_task_completions. This new function
-- ONLY counts homework task completions so it can be safely merged with
-- the file-based function in the client without any double-counting risk,
-- regardless of whether update_classroom_edu_top3_with_homework.sql was
-- previously applied.
--
-- Also reverts get_classroom_edu_top3 to file-only (no-op if it was
-- never updated, idempotent if it was).
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── 1. Revert get_classroom_edu_top3 to file-only (idempotent) ────────────
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
  WITH students AS (
    SELECT cm.user_id AS student_id
    FROM classroom_members cm
    WHERE cm.classroom_id = p_classroom_id AND cm.role = 'student'
  ),
  pts AS (
    SELECT s.student_id,
           COALESCE(SUM(CASE WHEN pr.status = 'completed' THEN cf.edu_points ELSE 0 END), 0) AS points
    FROM students s
    LEFT JOIN classroom_folders fo ON fo.classroom_id = p_classroom_id
    LEFT JOIN classroom_files cf   ON cf.folder_id = fo.id
    LEFT JOIN classroom_file_progress pr ON pr.file_id = cf.id AND pr.student_id = s.student_id
    GROUP BY s.student_id
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

-- ── 2. New function: homework-only EduPoints per classroom ─────────────────
CREATE OR REPLACE FUNCTION public.get_classroom_homework_edu_top3(p_classroom_id UUID)
RETURNS TABLE (
  student_id UUID,
  full_name  TEXT,
  avatar_url TEXT,
  points     INTEGER
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
  WITH students AS (
    SELECT cm.user_id AS student_id
    FROM classroom_members cm
    WHERE cm.classroom_id = p_classroom_id AND cm.role = 'student'
  ),
  hw_pts AS (
    SELECT s.student_id,
           COALESCE(SUM(
             CASE WHEN tc.status = 'checked'
                    OR (tc.status = 'done' AND COALESCE(t.require_check, false) = false)
                  THEN t.edu_points ELSE 0 END
           ), 0) AS points
    FROM students s
    LEFT JOIN smartboard_tasks t ON t.classroom_id = p_classroom_id
    LEFT JOIN smartboard_task_completions tc
           ON tc.task_id = t.id AND tc.student_id = s.student_id
    GROUP BY s.student_id
  )
  SELECT pts.student_id, pf.full_name, pf.avatar_url, pts.points::INTEGER
  FROM hw_pts pts
  JOIN profiles pf ON pf.id = pts.student_id
  WHERE pts.points > 0
  ORDER BY pts.points DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_homework_edu_top3(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
