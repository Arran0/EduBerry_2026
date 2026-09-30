-- Server-side paging for the two admin managers big enough to need it: the
-- classroom manager (325 classrooms) and the student profile manager (1051
-- students). Both used to pull the whole table — every column of every row —
-- and do all the searching, sorting and counting in the browser.
--
-- Both functions are SECURITY INVOKER (the default), so RLS still decides
-- which rows the caller may see; these only decide how many cross the wire.

-- ── Classroom manager ───────────────────────────────────────────────────────
-- One round trip returns: a page of classrooms (active first, newest first
-- within each band), the member count for each, and the size of both bands so
-- the header and the "N of M" readout have their totals without a second
-- query. The whole classroom row comes back as a composite so the client keeps
-- its existing Classroom type.
CREATE OR REPLACE FUNCTION public.classroom_manager_page(
  p_search text DEFAULT '',
  p_limit  integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  classroom    public.classrooms,
  member_count integer,
  is_closed    boolean,
  active_total integer,
  closed_total integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  WITH matched AS (
    SELECT
      c AS row,
      c.id AS id,
      c.created_at AS created_at,
      (c.end_date IS NOT NULL AND c.end_date < current_date) AS closed
    FROM public.classrooms c
    WHERE p_search = ''
       OR c.title ILIKE '%' || p_search || '%'
       OR coalesce(c.description, '') ILIKE '%' || p_search || '%'
  ),
  tallied AS (
    SELECT
      m.*,
      (count(*) FILTER (WHERE NOT m.closed) OVER ())::int AS active_total,
      (count(*) FILTER (WHERE m.closed)     OVER ())::int AS closed_total
    FROM matched m
  )
  SELECT
    t.row,
    coalesce(mc.n, 0),
    t.closed,
    t.active_total,
    t.closed_total
  FROM tallied t
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
    FROM public.classroom_members cm
    WHERE cm.classroom_id = t.id
  ) mc ON true
  ORDER BY t.closed, t.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$fn$;

GRANT EXECUTE ON FUNCTION public.classroom_manager_page(text, integer, integer) TO authenticated;

-- ── Student roster facets ───────────────────────────────────────────────────
-- The grade and section dropdowns label each option with how many students it
-- holds. Those tallies are taken over the search-matched roster but *not* the
-- grade/section/status selection, so switching one filter never moves the
-- numbers the admin is reading right before they click. With the roster itself
-- now arriving a page at a time, the browser can no longer count them; this
-- does it in one aggregate instead.
--
-- p_grades is the set of grade values whose label matches the search text
-- (e.g. "gra" → every Grade N). Those labels live in src/lib/grades.ts —
-- pre-primary grades are negative integers with names of their own, so the
-- caller resolves them and passes the values down.
CREATE OR REPLACE FUNCTION public.student_roster_facets(
  p_search text DEFAULT '',
  p_grades integer[] DEFAULT '{}'
)
RETURNS TABLE (facet text, key text, n integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  WITH matched AS (
    SELECT p.grade, p.section
    FROM public.profiles p
    WHERE p.role = 'student'
      AND (
        p_search = ''
        OR p.full_name ILIKE '%' || p_search || '%'
        OR p.email ILIKE '%' || p_search || '%'
        OR coalesce(p.section, '') ILIKE '%' || p_search || '%'
        OR p.grade = ANY(p_grades)
      )
  )
  SELECT 'grade', m.grade::text, count(*)::int
  FROM matched m WHERE m.grade IS NOT NULL GROUP BY m.grade
  UNION ALL
  SELECT 'section', m.section, count(*)::int
  FROM matched m WHERE coalesce(m.section, '') <> '' GROUP BY m.section;
$fn$;

GRANT EXECUTE ON FUNCTION public.student_roster_facets(text, integer[]) TO authenticated;
