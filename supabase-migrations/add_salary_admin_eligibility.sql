-- ============================================================================
-- add_salary_admin_eligibility  —  admins are staff too, for payroll purposes.
-- ============================================================================
-- Run this in the Supabase SQL Editor, after add_unified_cycle_records.sql.
-- Safe to re-run.
--
-- generate_salary_cycle only ever included teacher / coordinator / principal
-- (plus driver, since add_unified_cycle_records.sql). Admin accounts are
-- staff too — isStaffRole() in the app already treats them as such — so an
-- admin with a base salary configured in the Salary app was never actually
-- given a salary record when a cycle ran. This brings the cycle-generation
-- function in line with the app's own definition of "staff", matching the
-- Base Salaries / Bank Accounts screens (see fetchEligibleStaff in
-- src/lib/salary.ts).
--
-- Whether a given admin should really be on payroll — vs. an account that
-- just administers the system — is left to the per-person "Active" toggle
-- in Base Salaries and the "hidden from Salary app" list in Salary Settings,
-- same as for any other staff member.

CREATE OR REPLACE FUNCTION public.generate_salary_cycle(p_month SMALLINT, p_year SMALLINT)
RETURNS TABLE (cycle_id UUID, created_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cycle_id UUID;
  v_created INT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  INSERT INTO public.salary_cycles (period_month, period_year, created_by)
  VALUES (p_month, p_year, auth.uid())
  ON CONFLICT (period_year, period_month) DO UPDATE SET period_month = EXCLUDED.period_month
  RETURNING id INTO v_cycle_id;

  WITH inserted AS (
    INSERT INTO public.salary_records (cycle_id, staff_id, base_amount, created_by)
    SELECT v_cycle_id, p.id, COALESCE(sb.base_amount, db.base_amount, 0), auth.uid()
    FROM public.profiles p
    LEFT JOIN public.staff_salary_base   sb ON sb.staff_id  = p.id
    LEFT JOIN public.driver_payroll_base db ON db.driver_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'admin', 'driver')
      AND (sb.id IS NULL OR sb.active = true)
      AND (db.id IS NULL OR db.active = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.salary_records r
        WHERE r.cycle_id = v_cycle_id AND r.staff_id = p.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

NOTIFY pgrst, 'reload schema';
