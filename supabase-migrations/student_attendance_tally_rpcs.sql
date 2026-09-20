-- Two tallies that the browser was computing by hand:
--   * the home dashboard's whole-school present/absent/irregular tile fired
--     three separate count round-trips for one date;
--   * the homeroom-wise report downloaded every attendance row for the page of
--     homerooms on screen (paged 1000 at a time) just to produce three numbers
--     per homeroom.
-- Both collapse to one aggregate round trip. SECURITY INVOKER (the default) is
-- deliberate: RLS still applies, so a student calling these sees exactly the
-- rows they could already count for themselves.

CREATE OR REPLACE FUNCTION public.student_attendance_tally(p_date date)
RETURNS TABLE (present integer, absent integer, irregular integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT
    count(*) FILTER (WHERE status IN ('present','late','on_duty'))::int,
    count(*) FILTER (WHERE status IN ('absent','on_leave'))::int,
    count(*) FILTER (WHERE status NOT IN ('present','late','on_duty','absent','on_leave'))::int
  FROM public.attendance_records
  WHERE date = p_date;
$fn$;

CREATE OR REPLACE FUNCTION public.homeroom_attendance_counts(
  p_date date,
  p_homeroom_ids uuid[]
)
RETURNS TABLE (homeroom_id uuid, present integer, absent integer, irregular integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT
    ar.homeroom_id,
    count(*) FILTER (WHERE ar.status IN ('present','late','on_duty'))::int,
    count(*) FILTER (WHERE ar.status IN ('absent','on_leave'))::int,
    count(*) FILTER (WHERE ar.status NOT IN ('present','late','on_duty','absent','on_leave'))::int
  FROM public.attendance_records ar
  WHERE ar.date = p_date
    AND ar.homeroom_id = ANY(p_homeroom_ids)
  GROUP BY ar.homeroom_id;
$fn$;

GRANT EXECUTE ON FUNCTION public.student_attendance_tally(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeroom_attendance_counts(date, uuid[]) TO authenticated;
