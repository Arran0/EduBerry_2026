-- ============================================================
-- Cost/performance optimization: mark RLS helper functions STABLE.
--
-- These 5 functions are called inside RLS policy predicates but were left
-- at Postgres's default VOLATILE, which forbids the planner from caching
-- the result even for identical arguments within the same statement. All
-- five only SELECT (no writes), so STABLE is correct.
-- ============================================================

ALTER FUNCTION public.is_classroom_member(uuid) STABLE;
ALTER FUNCTION public.is_classroom_staff(uuid) STABLE;
ALTER FUNCTION public.is_homeroom_member(uuid) STABLE;
ALTER FUNCTION public.is_homeroom_smartboard(uuid) STABLE;
ALTER FUNCTION public.is_smartboard_of_student(uuid) STABLE;

NOTIFY pgrst, 'reload schema';
