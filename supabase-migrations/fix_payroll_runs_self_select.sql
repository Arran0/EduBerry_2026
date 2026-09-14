-- payroll_runs_select_merged carried a broken correlation in its EXISTS clause:
--
--     EXISTS (SELECT 1 FROM payroll_run_lines l
--             WHERE l.run_id = l.id AND l.employee_id = (SELECT auth.uid()))
--
-- `l.run_id = l.id` compares a line's run to the line's OWN id instead of to
-- the payroll_runs row being filtered, so the subquery is not correlated with
-- the outer table at all. Two consequences:
--
--   1. It fails closed for the case it was written for — an employee never
--      sees the locked run their own payslip line belongs to, because
--      run_id = id is false for every real line (they are distinct uuids).
--   2. Had any row ever satisfied it, it would have failed OPEN in the worst
--      possible way: one matching line would expose EVERY locked/paid/
--      reconciled run to that employee, since nothing ties the subquery to the
--      run being tested.
--
-- Fixed to correlate against payroll_runs.id. Everything else in the policy —
-- the admin branch, the status whitelist, the scalar-subquery auth.uid() — is
-- kept verbatim.

DROP POLICY IF EXISTS payroll_runs_select_merged ON public.payroll_runs;

CREATE POLICY payroll_runs_select_merged ON public.payroll_runs
  FOR SELECT
  USING (
    ((SELECT public.get_user_role()) = 'admin'::text)
    OR (
      (status = ANY (ARRAY['locked'::text, 'paid'::text, 'reconciled'::text]))
      AND EXISTS (
        SELECT 1 FROM public.payroll_run_lines l
        WHERE l.run_id = payroll_runs.id
          AND l.employee_id = (SELECT auth.uid())
      )
    )
  );
