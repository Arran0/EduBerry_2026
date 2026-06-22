-- ============================================================
-- Migration: Classroom Top-3 EduPoints includes homework
--
-- The original get_classroom_edu_top3 only summed EduPoints from completed
-- classroom_files. Homework is now a smartboard_task linked to the classroom,
-- so its points were invisible to the "Top of the Class" board — it read zero
-- even when students had earned points on homework. This redefinition sums BOTH
-- sources:
--   • classroom_files marked 'completed'
--   • classroom homework (smartboard_tasks) the student has finished:
--       status 'checked', or 'done' when the task needs no verification
--
-- Run in the Supabase SQL Editor (after add_smartboard_task_verification.sql).
-- ============================================================

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
  file_pts AS (
    SELECT s.student_id,
           COALESCE(SUM(CASE WHEN pr.status = 'completed' THEN cf.edu_points ELSE 0 END), 0) AS points
    FROM students s
    LEFT JOIN classroom_folders fo ON fo.classroom_id = p_classroom_id
    LEFT JOIN classroom_files cf   ON cf.folder_id = fo.id
    LEFT JOIN classroom_file_progress pr ON pr.file_id = cf.id AND pr.student_id = s.student_id
    GROUP BY s.student_id
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
    LEFT JOIN smartboard_task_completions tc ON tc.task_id = t.id AND tc.student_id = s.student_id
    GROUP BY s.student_id
  ),
  pts AS (
    SELECT u.student_id, SUM(u.points) AS points
    FROM (
      SELECT student_id, points FROM file_pts
      UNION ALL
      SELECT student_id, points FROM hw_pts
    ) u
    GROUP BY u.student_id
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
