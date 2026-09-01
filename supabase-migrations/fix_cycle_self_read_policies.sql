-- ============================================================================
-- Staff and drivers could not read the pay cycle their own record belongs to.
--
-- Both self-read policies were written as:
--
--     EXISTS (SELECT 1 FROM salary_records sr
--             WHERE sr.cycle_id = id AND sr.staff_id = auth.uid())
--
-- The bare `id` was meant to be the outer `salary_cycles.id`, but Postgres
-- resolves an unqualified column against the innermost table in scope — so it
-- read `sr.cycle_id = sr.id`, comparing a record's cycle to its own primary
-- key. That is never true, so the policy denied every row and the whole table
-- was invisible to non-admins. No error surfaced: PostgREST simply returned
-- the embedded `cycle:salary_cycles(*)` as null, and the staff salary page
-- showed payslips with no month against them at all.
--
-- Qualifying the reference fixes both tables. The scope is unchanged from what
-- the policies were always meant to express: you may read a cycle you have a
-- record in, and no other.
-- ============================================================================

DROP POLICY IF EXISTS "Staff views own cycles" ON public.salary_cycles;

CREATE POLICY "Staff views own cycles"
  ON public.salary_cycles FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.salary_records sr
    WHERE sr.cycle_id = public.salary_cycles.id
      AND sr.staff_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Driver views own cycles" ON public.driver_payroll_cycles;

CREATE POLICY "Driver views own cycles"
  ON public.driver_payroll_cycles FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.driver_payroll_records r
    WHERE r.cycle_id = public.driver_payroll_cycles.id
      AND r.driver_id = (SELECT auth.uid())
  ));
