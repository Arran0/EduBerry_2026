-- Staff could rewrite their own attendance row directly from the browser.
--
-- Both the INSERT and UPDATE policies carried a `staff_id = auth.uid()` arm,
-- and the UPDATE policy's WITH CHECK was *only* that arm. Two consequences,
-- both verified against the live database before this migration:
--
--   1. A teacher could flip their own `absent` day to `present`, and set
--      `marked_by` to an admin's id with a matching remark, using nothing but
--      their own session. `guard_attendance_location_columns` blocks the
--      GPS/time columns, but not `status`, `marked_by` or `remarks` — so the
--      geofenced punch flow could be bypassed for the field payroll reads
--      (see lib/payroll/engine/attendance.ts, which prices LOP off `status`).
--   2. Because WITH CHECK was narrower than USING, an admin or coordinator
--      correcting *someone else's* row was rejected by RLS. Every
--      adminMarkStaffAttendance / syncLeaveToStaffAttendance call that landed
--      on an existing row failed silently (the helpers only console.error), so
--      quick-set did nothing on an already-marked day and approving leave over
--      one never updated attendance.
--
-- Fix: drop the self-write arms, and make WITH CHECK mirror USING.
-- Staff keep every legitimate write path, because none of them go through
-- these policies: `staff_attendance_punch` and `ack_forgotten_checkout` are
-- SECURITY DEFINER owned by postgres and the table is not FORCE ROW LEVEL
-- SECURITY, so they bypass RLS. The one client-side self-write helper,
-- staffUpdateOwnStatus, had no callers and is deleted in the same change.
-- SELECT is deliberately untouched: staff keep reading their own row.

DROP POLICY "Coordinators can insert team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can insert team staff attendance" ON public.staff_attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    (((SELECT get_user_role()) = 'coordinator'::text) AND (staff_id IN (SELECT my_teammate_ids())))
    OR ((SELECT get_user_role()) = ANY (ARRAY['principal'::text, 'admin'::text]))
  );

DROP POLICY "Coordinators can update team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can update team staff attendance" ON public.staff_attendance_records
  FOR UPDATE TO authenticated
  USING (
    (((SELECT get_user_role()) = 'coordinator'::text) AND (staff_id IN (SELECT my_teammate_ids())))
    OR ((SELECT get_user_role()) = ANY (ARRAY['principal'::text, 'admin'::text]))
  )
  WITH CHECK (
    (((SELECT get_user_role()) = 'coordinator'::text) AND (staff_id IN (SELECT my_teammate_ids())))
    OR ((SELECT get_user_role()) = ANY (ARRAY['principal'::text, 'admin'::text]))
  );

-- my_teammate_ids() backs the policies above, which are `TO authenticated`.
-- Postgres's default PUBLIC grant leaves it callable as
-- /rest/v1/rpc/my_teammate_ids with the anon key; it returns nothing there
-- (auth.uid() is null) but there is no reason to expose it. Same narrowing
-- already applied to the smartboard RLS helpers.
REVOKE EXECUTE ON FUNCTION public.my_teammate_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_teammate_ids() TO authenticated;
