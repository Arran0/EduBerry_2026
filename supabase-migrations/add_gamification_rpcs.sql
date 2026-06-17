-- ============================================================
-- Migration: Gamification RPCs (EduPoints standings & trends)
-- Points are derived live from classroom_file_progress: a file's
-- edu_points count once the student's progress is 'completed'.
-- These SECURITY DEFINER functions are needed because row-level
-- security hides other students' progress, but leaderboards and
-- staff analysis must read across all students in a classroom.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── get_student_edu_standings ────────────────────────────────
-- Per classroom the student belongs to: their derived EduPoints,
-- their rank among that classroom's students, and the class size.
-- Callable for yourself, or by staff (principal/admin via JWT).

CREATE OR REPLACE FUNCTION public.get_student_edu_standings(p_student_id UUID)
RETURNS TABLE (
  classroom_id    UUID,
  classroom_title TEXT,
  points          INTEGER,
  rank            INTEGER,
  total_students  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_student_id <> auth.uid()
     AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') NOT IN ('teacher', 'coordinator', 'principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH student_classrooms AS (
    SELECT cm.classroom_id, c.title AS classroom_title
    FROM classroom_members cm
    JOIN classrooms c ON c.id = cm.classroom_id
    WHERE cm.user_id = p_student_id AND cm.role = 'student'
  ),
  pts AS (
    SELECT cm.classroom_id,
           cm.user_id AS student_id,
           COALESCE(SUM(CASE WHEN pr.status = 'completed' THEN cf.edu_points ELSE 0 END), 0) AS points
    FROM classroom_members cm
    JOIN student_classrooms sc ON sc.classroom_id = cm.classroom_id
    LEFT JOIN classroom_folders fo ON fo.classroom_id = cm.classroom_id
    LEFT JOIN classroom_files cf ON cf.folder_id = fo.id
    LEFT JOIN classroom_file_progress pr ON pr.file_id = cf.id AND pr.student_id = cm.user_id
    WHERE cm.role = 'student'
    GROUP BY cm.classroom_id, cm.user_id
  ),
  ranked AS (
    SELECT pts.classroom_id, pts.student_id, pts.points,
           RANK()  OVER (PARTITION BY pts.classroom_id ORDER BY pts.points DESC) AS rnk,
           COUNT(*) OVER (PARTITION BY pts.classroom_id)                          AS total
    FROM pts
  )
  SELECT r.classroom_id,
         sc.classroom_title,
         r.points::INTEGER,
         r.rnk::INTEGER,
         r.total::INTEGER
  FROM ranked r
  JOIN student_classrooms sc ON sc.classroom_id = r.classroom_id
  WHERE r.student_id = p_student_id
  ORDER BY sc.classroom_title;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_edu_standings(UUID) TO authenticated;

-- ── get_classroom_edu_monthly ────────────────────────────────
-- Student-wise EduPoints earned per calendar month in a classroom
-- (bucketed by when each file was marked 'completed'). Powers the
-- staff Analysis tab's monthly increase/decrease view. Staff only.

CREATE OR REPLACE FUNCTION public.get_classroom_edu_monthly(p_classroom_id UUID)
RETURNS TABLE (
  student_id UUID,
  full_name  TEXT,
  month      DATE,
  points     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
        SELECT 1 FROM classroom_members
        WHERE classroom_id = p_classroom_id
          AND user_id = auth.uid()
          AND role IN ('teacher', 'coordinator', 'principal', 'admin')
      )
     AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') NOT IN ('principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT pr.student_id,
         pf.full_name,
         date_trunc('month', pr.updated_at)::DATE AS month,
         SUM(cf.edu_points)::INTEGER             AS points
  FROM classroom_file_progress pr
  JOIN classroom_files cf   ON cf.id = pr.file_id
  JOIN classroom_folders fo ON fo.id = cf.folder_id
  JOIN profiles pf          ON pf.id = pr.student_id
  WHERE fo.classroom_id = p_classroom_id
    AND pr.status = 'completed'
    AND cf.edu_points > 0
  GROUP BY pr.student_id, pf.full_name, date_trunc('month', pr.updated_at)
  ORDER BY pf.full_name, month;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_edu_monthly(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
