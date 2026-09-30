-- The classroom manager showed "0 members" for almost every classroom while the
-- expanded panel showed the right number. Cause: the list counted members in
-- the browser from
--
--   select classroom_id, user_id from classroom_members
--     in ('classroom_id', <325 ids>)
--
-- and PostgREST caps a plain select at 1000 rows. classroom_members is ~10.7k
-- rows, so the browser only ever saw the first 1000 — a handful of classrooms
-- got a count and the remaining ~300 fell through to 0. Opening one hit
-- fetchClassroomById, a single-classroom query well under the cap, which is why
-- it disagreed with the row above it.
--
-- One aggregate round trip instead, with the count done where the rows are.
-- SECURITY INVOKER (the default) is deliberate: RLS still applies, so a caller
-- counts exactly the membership rows they could already read for themselves.

CREATE OR REPLACE FUNCTION public.classroom_member_counts(p_classroom_ids uuid[])
RETURNS TABLE (classroom_id uuid, member_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT cm.classroom_id, count(*)::int
  FROM public.classroom_members cm
  WHERE cm.classroom_id = ANY(p_classroom_ids)
  GROUP BY cm.classroom_id;
$fn$;

GRANT EXECUTE ON FUNCTION public.classroom_member_counts(uuid[]) TO authenticated;
