-- ============================================================
-- Migration: one-call student EduPoints dashboard  [APPLIED]
--
-- The academics "My EduPoints" carousel used to need four round trips:
--   get_student_edu_standings (points + rank + class size)
--   get_student_edu_rank_trend (last month's rank — never actually deployed)
--   two client queries to tally smart-board homework points
-- and the two RPCs each re-derived the same per-classroom leaderboard.
--
-- This returns all of it in one call, and aggregates points straight off the
-- progress rows instead of off a classroom_members x classroom_files cross
-- product (the old standings query fanned every member out across every file
-- in the classroom before grouping).
--
-- Point semantics are unchanged on purpose: `rank`/`total_students` rank on
-- coursework points, exactly as the old standings RPC did, while `hw_points` is
-- returned separately for the client to add to the displayed total — which is
-- what the client already did. (That rank/total mismatch is pre-existing
-- behaviour, not something this migration changes.)
--
-- get_student_edu_standings is left in place so a deployment running the old
-- client keeps working; it can be dropped once this release is live.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_edu_dashboard(p_student_id UUID)
RETURNS TABLE (
  classroom_id    UUID,
  classroom_title TEXT,
  points          INTEGER,
  hw_points       INTEGER,
  rank            INTEGER,
  total_students  INTEGER,
  prev_rank       INTEGER
)
LANGUAGE plpgsql
STABLE
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
    SELECT cm.classroom_id, c.title AS classroom_title
    FROM classroom_members cm
    JOIN classrooms c ON c.id = cm.classroom_id
    WHERE cm.user_id = p_student_id AND cm.role = 'student'
  ),
  -- Every point-bearing coursework file in those classrooms, once.
  cls_files AS (
    SELECT fo.classroom_id, cf.id AS file_id, cf.edu_points
    FROM classroom_folders fo
    JOIN classroom_files cf ON cf.folder_id = fo.id
    WHERE fo.classroom_id IN (SELECT sc.classroom_id FROM student_classrooms sc)
  ),
  -- Members of those classrooms, so every student is ranked (even at zero).
  members AS (
    SELECT cm.classroom_id, cm.user_id AS student_id
    FROM classroom_members cm
    WHERE cm.role = 'student'
      AND cm.classroom_id IN (SELECT sc.classroom_id FROM student_classrooms sc)
  ),
  earned AS (
    SELECT f.classroom_id,
           pr.student_id,
           SUM(f.edu_points) AS curr_points,
           SUM(CASE WHEN pr.updated_at < month_start THEN f.edu_points ELSE 0 END) AS prev_points
    FROM cls_files f
    JOIN classroom_file_progress pr
      ON pr.file_id = f.file_id AND pr.status = 'completed'
    GROUP BY f.classroom_id, pr.student_id
  ),
  pts AS (
    SELECT m.classroom_id,
           m.student_id,
           COALESCE(e.curr_points, 0) AS curr_points,
           COALESCE(e.prev_points, 0) AS prev_points
    FROM members m
    LEFT JOIN earned e
      ON e.classroom_id = m.classroom_id AND e.student_id = m.student_id
  ),
  ranked AS (
    SELECT pts.classroom_id,
           pts.student_id,
           pts.curr_points,
           RANK()   OVER (PARTITION BY pts.classroom_id ORDER BY pts.curr_points DESC) AS curr_rnk,
           RANK()   OVER (PARTITION BY pts.classroom_id ORDER BY pts.prev_points DESC) AS prev_rnk,
           COUNT(*) OVER (PARTITION BY pts.classroom_id)                               AS total
    FROM pts
  ),
  -- Homework EduPoints from smart-board tasks: 'checked' always counts, 'done'
  -- only when the task needs no verification. Homeroom-only tasks (no
  -- classroom) are excluded, exactly as the client used to compute this.
  hw AS (
    SELECT t.classroom_id, SUM(t.edu_points)::INTEGER AS hw_points
    FROM smartboard_task_completions comp
    JOIN smartboard_tasks t ON t.id = comp.task_id
    WHERE comp.student_id = p_student_id
      AND t.classroom_id IS NOT NULL
      AND t.edu_points > 0
      AND (CASE WHEN t.require_check THEN comp.status = 'checked'
                ELSE comp.status IN ('done', 'checked') END)
    GROUP BY t.classroom_id
  )
  SELECT r.classroom_id,
         sc.classroom_title,
         r.curr_points::INTEGER,
         COALESCE(hw.hw_points, 0),
         r.curr_rnk::INTEGER,
         r.total::INTEGER,
         r.prev_rnk::INTEGER
  FROM ranked r
  JOIN student_classrooms sc ON sc.classroom_id = r.classroom_id
  LEFT JOIN hw ON hw.classroom_id = r.classroom_id
  WHERE r.student_id = p_student_id
  ORDER BY sc.classroom_title;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would leave this
-- callable with the anon key — revoke that before granting.
REVOKE EXECUTE ON FUNCTION public.get_student_edu_dashboard(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_student_edu_dashboard(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_student_edu_dashboard(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
