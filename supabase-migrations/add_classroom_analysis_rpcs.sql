-- ============================================================
-- Migration: Classroom Analysis tab RPCs
--
-- The Analysis tab used to pull every student × month row from
-- get_classroom_edu_monthly plus every mark of every assessment (one request
-- per assessment) and do all the maths in the browser. These functions do the
-- aggregation in Postgres and return only what the tab draws:
--
--   • get_classroom_edu_month_summary — one row per month: class average,
--     that month's top scorer and most improved student, and optionally one
--     focused student's points (the chart + highlight cards).
--   • get_classroom_edu_leaderboard   — one month's ranking, "highest total"
--     or "most improved", paged (10 at a time in the UI).
--   • get_classroom_assessment_trend  — per assessment, class average % and
--     optionally one student's % (the assessment chart).
--
-- EduPoints count both sources, exactly as get_classroom_edu_top3 does:
--   • classroom_files marked 'completed'
--   • classroom homework (smartboard_tasks): 'checked', or 'done' when the
--     task needs no verification
-- Points are bucketed by the IST calendar month they were earned in.
--
-- Also hardens get_classroom_edu_monthly: it trusted the role in
-- auth.jwt() -> user_metadata, which a user can set on themselves.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ── Access check: classroom staff, or a school principal/admin ──
CREATE OR REPLACE FUNCTION public._assert_classroom_staff(p_classroom_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
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
     AND COALESCE(public.get_user_role(), '') NOT IN ('principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._assert_classroom_staff(UUID) FROM PUBLIC, anon, authenticated;

-- ── EduPoints earned per current student per month (internal) ──
-- p_from / p_to (first-of-month dates) narrow the window when only a month or
-- two is needed.
CREATE OR REPLACE FUNCTION public._classroom_edu_earned(
  p_classroom_id UUID,
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (student_id UUID, month DATE, points INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH file_pts AS (
    SELECT pr.student_id,
           date_trunc('month', pr.updated_at AT TIME ZONE 'Asia/Kolkata')::DATE AS month,
           cf.edu_points AS points
    FROM classroom_folders fo
    JOIN classroom_files cf          ON cf.folder_id = fo.id AND cf.edu_points > 0
    JOIN classroom_file_progress pr  ON pr.file_id = cf.id AND pr.status = 'completed'
    WHERE fo.classroom_id = p_classroom_id
  ),
  hw_pts AS (
    SELECT tc.student_id,
           date_trunc('month', tc.updated_at AT TIME ZONE 'Asia/Kolkata')::DATE AS month,
           t.edu_points AS points
    FROM smartboard_tasks t
    JOIN smartboard_task_completions tc ON tc.task_id = t.id
    WHERE t.classroom_id = p_classroom_id
      AND t.edu_points > 0
      AND (CASE WHEN COALESCE(t.require_check, false) THEN tc.status = 'checked'
                ELSE tc.status IN ('done', 'checked') END)
  )
  SELECT u.student_id, u.month, SUM(u.points)::INTEGER
  FROM (SELECT * FROM file_pts UNION ALL SELECT * FROM hw_pts) u
  JOIN classroom_members cm
    ON cm.classroom_id = p_classroom_id AND cm.user_id = u.student_id AND cm.role = 'student'
  WHERE (p_from IS NULL OR u.month >= p_from)
    AND (p_to   IS NULL OR u.month <= p_to)
  GROUP BY u.student_id, u.month;
$$;

REVOKE EXECUTE ON FUNCTION public._classroom_edu_earned(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

-- ── get_classroom_edu_month_summary ──────────────────────────
-- One row per month from the first month with points (at most 24 back) up to
-- the current month, gaps included so the chart reads zero rather than
-- skipping a month. class_avg divides by every student in the class, not
-- only those who earned something.
CREATE OR REPLACE FUNCTION public.get_classroom_edu_month_summary(
  p_classroom_id UUID,
  p_student_id   UUID DEFAULT NULL
)
RETURNS TABLE (
  month                 DATE,
  class_avg             NUMERIC,
  top_points            INTEGER,
  top_student_id        UUID,
  top_student_name      TEXT,
  improved_student_id   UUID,
  improved_student_name TEXT,
  improved_delta        INTEGER,
  student_points        INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now DATE := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
  PERFORM public._assert_classroom_staff(p_classroom_id);

  RETURN QUERY
  WITH earned AS MATERIALIZED (
    SELECT * FROM public._classroom_edu_earned(p_classroom_id, (v_now - INTERVAL '24 months')::DATE, v_now)
  ),
  bounds AS (
    SELECT GREATEST(COALESCE(MIN(e.month), v_now), (v_now - INTERVAL '23 months')::DATE) AS first_month
    FROM earned e
  ),
  students AS (
    SELECT cm.user_id AS student_id, pf.full_name
    FROM classroom_members cm
    JOIN profiles pf ON pf.id = cm.user_id
    WHERE cm.classroom_id = p_classroom_id AND cm.role = 'student'
  ),
  -- One month before the first shown, so the first month has a "previous".
  months AS (
    SELECT gs::DATE AS month, gs::DATE >= b.first_month AS shown
    FROM bounds b,
         generate_series((b.first_month - INTERVAL '1 month')::DATE, v_now, INTERVAL '1 month') gs
  ),
  grid AS (
    SELECT m.month, s.student_id, s.full_name,
           COALESCE(e.points, 0) AS points,
           COALESCE(e.points, 0)
             - LAG(COALESCE(e.points, 0), 1, 0) OVER (PARTITION BY s.student_id ORDER BY m.month) AS delta
    FROM months m
    CROSS JOIN students s
    LEFT JOIN earned e ON e.student_id = s.student_id AND e.month = m.month
  ),
  agg AS (
    SELECT g.month,
           ROUND(AVG(g.points), 1) AS class_avg,
           MAX(g.points) FILTER (WHERE g.student_id = p_student_id) AS student_points
    FROM grid g
    GROUP BY g.month
  ),
  top AS (
    SELECT DISTINCT ON (g.month) g.month, g.student_id, g.full_name, g.points
    FROM grid g
    WHERE g.points > 0
    ORDER BY g.month, g.points DESC, g.full_name
  ),
  improved AS (
    SELECT DISTINCT ON (g.month) g.month, g.student_id, g.full_name, g.delta
    FROM grid g
    WHERE g.delta > 0
    ORDER BY g.month, g.delta DESC, g.points DESC, g.full_name
  )
  SELECT m.month,
         COALESCE(a.class_avg, 0),
         COALESCE(t.points, 0)::INTEGER,
         t.student_id,
         t.full_name,
         i.student_id,
         i.full_name,
         i.delta::INTEGER,
         CASE WHEN p_student_id IS NULL THEN NULL ELSE COALESCE(a.student_points, 0)::INTEGER END
  FROM months m
  LEFT JOIN agg a      ON a.month = m.month
  LEFT JOIN top t      ON t.month = m.month
  LEFT JOIN improved i ON i.month = m.month
  WHERE m.shown
  ORDER BY m.month;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_edu_month_summary(UUID, UUID) TO authenticated;

-- ── get_classroom_edu_leaderboard ────────────────────────────
-- Every student in the class for one month (zeros included), ranked by that
-- month's points ('total') or by the change on the month before ('improved').
-- total_count is the full list length so the UI knows how many remain.
CREATE OR REPLACE FUNCTION public.get_classroom_edu_leaderboard(
  p_classroom_id UUID,
  p_month        DATE,
  p_sort         TEXT    DEFAULT 'total',
  p_limit        INTEGER DEFAULT 10,
  p_offset       INTEGER DEFAULT 0
)
RETURNS TABLE (
  student_id  UUID,
  full_name   TEXT,
  avatar_url  TEXT,
  points      INTEGER,
  prev_points INTEGER,
  delta       INTEGER,
  rank        INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month    DATE    := date_trunc('month', p_month)::DATE;
  v_prev     DATE    := (date_trunc('month', p_month) - INTERVAL '1 month')::DATE;
  v_improved BOOLEAN := p_sort = 'improved';
BEGIN
  PERFORM public._assert_classroom_staff(p_classroom_id);

  RETURN QUERY
  WITH earned AS (
    SELECT * FROM public._classroom_edu_earned(p_classroom_id, v_prev, v_month)
  ),
  roster AS (
    SELECT cm.user_id AS student_id,
           pf.full_name,
           pf.avatar_url,
           COALESCE(cur.points, 0)  AS points,
           COALESCE(prev.points, 0) AS prev_points,
           COALESCE(cur.points, 0) - COALESCE(prev.points, 0) AS delta
    FROM classroom_members cm
    JOIN profiles pf      ON pf.id = cm.user_id
    LEFT JOIN earned cur  ON cur.student_id  = cm.user_id AND cur.month  = v_month
    LEFT JOIN earned prev ON prev.student_id = cm.user_id AND prev.month = v_prev
    WHERE cm.classroom_id = p_classroom_id AND cm.role = 'student'
  ),
  ranked AS (
    SELECT r.*,
           RANK() OVER (ORDER BY CASE WHEN v_improved THEN r.delta ELSE r.points END DESC) AS rnk,
           COUNT(*) OVER () AS total
    FROM roster r
  )
  SELECT r.student_id, r.full_name, r.avatar_url,
         r.points::INTEGER, r.prev_points::INTEGER, r.delta::INTEGER,
         r.rnk::INTEGER, r.total::INTEGER
  FROM ranked r
  ORDER BY r.rnk, r.points DESC, r.full_name, r.student_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_edu_leaderboard(UUID, DATE, TEXT, INTEGER, INTEGER) TO authenticated;

-- ── get_classroom_assessment_trend ───────────────────────────
-- Chronological assessments with the class average % and, when a student is
-- given, that student's % — instead of shipping every mark to the browser.
CREATE OR REPLACE FUNCTION public.get_classroom_assessment_trend(
  p_classroom_id UUID,
  p_student_id   UUID DEFAULT NULL
)
RETURNS TABLE (
  assessment_id UUID,
  title         TEXT,
  date          DATE,
  class_avg     NUMERIC,
  student_pct   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_classroom_staff(p_classroom_id);

  RETURN QUERY
  SELECT a.id,
         a.title,
         a.date,
         ROUND(AVG(m.marks / m.max_marks * 100), 1),
         ROUND(MAX(m.marks / m.max_marks * 100) FILTER (WHERE m.student_id = p_student_id), 1)
  FROM classroom_assessments a
  LEFT JOIN classroom_assessment_marks m
    ON m.assessment_id = a.id
   AND m.marks IS NOT NULL
   AND m.max_marks > 0
   AND NOT COALESCE(m.is_absent, false)
  WHERE a.classroom_id = p_classroom_id
  GROUP BY a.id
  ORDER BY a.date, a.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_assessment_trend(UUID, UUID) TO authenticated;

-- ── Harden get_classroom_edu_monthly (kept for older clients) ──
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
  PERFORM public._assert_classroom_staff(p_classroom_id);

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

NOTIFY pgrst, 'reload schema';
