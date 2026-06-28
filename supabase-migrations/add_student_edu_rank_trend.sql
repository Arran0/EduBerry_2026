-- ============================================================
-- Migration: Student EduPoints rank trend (current vs. last month)
-- For each classroom the student belongs to, returns their current
-- leaderboard rank and their rank as of the start of the current
-- calendar month. The academics "My EduPoints" carousel uses this to
-- light up a celebratory "rank up" animation on classrooms where the
-- student has climbed since last month.
--
-- SECURITY DEFINER (mirrors get_student_edu_standings) so the function
-- can rank across all students despite row-level security. The client
-- degrades gracefully if this migration has not been run yet.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_edu_rank_trend(p_student_id UUID)
RETURNS TABLE (
  classroom_id UUID,
  curr_rank    INTEGER,
  prev_rank    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  month_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  IF p_student_id <> auth.uid()
     AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') NOT IN ('teacher', 'coordinator', 'principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH student_classrooms AS (
    SELECT cm.classroom_id
    FROM classroom_members cm
    WHERE cm.user_id = p_student_id AND cm.role = 'student'
  ),
  base AS (
    SELECT cm.classroom_id,
           cm.user_id AS student_id,
           cf.edu_points,
           pr.updated_at,
           pr.status
    FROM classroom_members cm
    JOIN student_classrooms sc ON sc.classroom_id = cm.classroom_id
    LEFT JOIN classroom_folders fo ON fo.classroom_id = cm.classroom_id
    LEFT JOIN classroom_files cf ON cf.folder_id = fo.id
    LEFT JOIN classroom_file_progress pr ON pr.file_id = cf.id AND pr.student_id = cm.user_id
    WHERE cm.role = 'student'
  ),
  agg AS (
    SELECT classroom_id,
           student_id,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN edu_points ELSE 0 END), 0) AS curr_points,
           COALESCE(SUM(CASE WHEN status = 'completed' AND updated_at < month_start THEN edu_points ELSE 0 END), 0) AS prev_points
    FROM base
    GROUP BY classroom_id, student_id
  ),
  ranked AS (
    SELECT classroom_id,
           student_id,
           RANK() OVER (PARTITION BY classroom_id ORDER BY curr_points DESC) AS curr_rnk,
           RANK() OVER (PARTITION BY classroom_id ORDER BY prev_points DESC) AS prev_rnk
    FROM agg
  )
  SELECT r.classroom_id, r.curr_rnk::INTEGER, r.prev_rnk::INTEGER
  FROM ranked r
  WHERE r.student_id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_edu_rank_trend(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
