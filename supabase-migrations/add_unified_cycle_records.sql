-- ============================================================================
-- add_unified_cycle_records  —  one pay cycle covering staff *and* drivers.
-- ============================================================================
-- Run this in the Supabase SQL Editor, after add_payroll_calibration.sql.
-- Safe to re-run.
--
-- Payroll is one monthly job for the office, so a cycle should list everyone
-- who gets paid. generate_salary_cycle now creates a salary_record for bus
-- drivers alongside teaching and non-teaching staff, instead of drivers
-- needing a parallel cycle of their own.
--
-- Base salaries keep living where they already do: staff_salary_base for
-- staff, driver_payroll_base for drivers. Both are joined and COALESCEd, so
-- the existing Base Salaries screen keeps writing to the same places and no
-- data has to move. A person is skipped only when they have a base row that
-- is explicitly inactive — someone with no base row at all is still included
-- with a base of 0, editable on the cycle page.
--
-- The driver_payroll_* tables and their pages stay in place so previously
-- generated driver cycles remain readable; nothing new is written to them.

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
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'driver')
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
