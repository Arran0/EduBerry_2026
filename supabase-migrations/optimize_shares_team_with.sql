-- ============================================================
-- Cost/performance optimization: replace the per-row shares_team_with()
-- call in staff_attendance_records RLS with a precomputed, uncorrelated
-- set the planner can evaluate once per statement.
--
-- shares_team_with(viewer, target) is STABLE, but its second argument
-- (target = staff_attendance_records.staff_id) is row-dependent, so
-- Postgres can never hoist or cache the call — it re-runs the full
-- team_members/teams CTE+UNION+join for every row scanned, under 4
-- separate policies.
--
-- my_teammate_ids() takes no row-dependent argument, so
-- `staff_id IN (SELECT public.my_teammate_ids())` is an uncorrelated
-- subquery: Postgres evaluates it once per statement and reuses the result
-- (typically hashed) for every row, instead of re-running the join per row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_teammate_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH my_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = auth.uid()
    UNION
    SELECT id AS team_id FROM public.teams WHERE coordinator_id = auth.uid()
  )
  SELECT tm.user_id
  FROM public.team_members tm
  JOIN my_teams mt ON tm.team_id = mt.team_id
  UNION
  SELECT t.coordinator_id
  FROM public.teams t
  JOIN my_teams mt ON t.id = mt.team_id
  WHERE t.coordinator_id IS NOT NULL;
$$;

-- Only `authenticated` needs to call this — RLS evaluates it as the
-- querying role, and every policy that references it is now scoped to
-- authenticated (see optimize_rls_scope_to_authenticated.sql). New
-- functions on this project pick up default anon+authenticated EXECUTE
-- grants (confirmed via information_schema.routine_privileges), so anon
-- must be explicitly revoked.
REVOKE EXECUTE ON FUNCTION public.my_teammate_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_teammate_ids() TO authenticated;

ALTER POLICY "Coordinators can insert team staff attendance" ON public.staff_attendance_records
  WITH CHECK ((((select get_user_role()) = 'coordinator'::text) AND staff_id IN (SELECT public.my_teammate_ids())));

ALTER POLICY "Coordinators can update team staff attendance" ON public.staff_attendance_records
  USING ((((select get_user_role()) = 'coordinator'::text) AND staff_id IN (SELECT public.my_teammate_ids())));

ALTER POLICY "Coordinators can view team staff attendance" ON public.staff_attendance_records
  USING ((((select get_user_role()) = 'coordinator'::text) AND staff_id IN (SELECT public.my_teammate_ids())));

ALTER POLICY "Teachers can view team staff attendance" ON public.staff_attendance_records
  USING ((((select get_user_role()) = 'teacher'::text) AND staff_id IN (SELECT public.my_teammate_ids())));

NOTIFY pgrst, 'reload schema';
