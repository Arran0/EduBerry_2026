-- ============================================================================
-- fix_salary_cycle_base_sync  —  catch up base_amount for records generated
-- before a base salary existed.
-- ============================================================================
-- Run this after add_support_staff_salary.sql. Safe to re-run.
--
-- generate_salary_cycle inserts a salary_record the first time a cycle sees a
-- person, defaulting base_amount to 0 when they have no Base Salaries /
-- driver / support-staff base row yet ("still included, at zero, to be
-- filled in on the cycle page" — see add_unified_cycle_records.sql). But an
-- open cycle stays open for weeks, and admins fill in Base Salaries and Bank
-- Accounts on their own schedule, often after the cycle already has a row for
-- that person. Nothing ever went back to pick up the number once it existed,
-- so support staff and drivers (and any staff) added to Base Salaries after
-- their cycle row was created stayed at ₹0 indefinitely, invisible unless an
-- admin happened to notice and hand-edit that one row.
--
-- Fix: after inserting missing rows, also catch up any existing row that is
-- still at the generator's zero default now that a real base is on file. A
-- row already carrying any other amount is a real edit (a raise, a manual
-- entry) and is left alone. A closed cycle is finalised history and is never
-- touched, insert or sync.

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

  IF (SELECT status FROM public.salary_cycles WHERE id = v_cycle_id) = 'closed' THEN
    RETURN QUERY SELECT v_cycle_id, 0;
    RETURN;
  END IF;

  WITH candidates AS (
    -- Profile-backed staff, drivers and admins.
    SELECT p.id AS staff_id, NULL::uuid AS support_staff_id,
           COALESCE(sb.base_amount, db.base_amount, 0) AS base_amount
    FROM public.profiles p
    LEFT JOIN public.staff_salary_base   sb ON sb.staff_id  = p.id
    LEFT JOIN public.driver_payroll_base db ON db.driver_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'admin', 'driver')
      AND (sb.id IS NULL OR sb.active = true)
      AND (db.id IS NULL OR db.active = true)

    UNION ALL

    -- Ground-level support staff — cleaning, maintenance, grounds. No
    -- profile, no login; a base row that is explicitly inactive keeps them
    -- off payroll the same way it does for staff and drivers.
    SELECT NULL::uuid AS staff_id, s.id AS support_staff_id,
           COALESCE(ssb.base_amount, 0) AS base_amount
    FROM public.support_staff s
    LEFT JOIN public.support_staff_salary_base ssb ON ssb.support_staff_id = s.id
    WHERE s.is_active = true
      AND (ssb.id IS NULL OR ssb.active = true)
  ),
  inserted AS (
    INSERT INTO public.salary_records (cycle_id, staff_id, support_staff_id, base_amount, created_by)
    SELECT v_cycle_id, c.staff_id, c.support_staff_id, c.base_amount, auth.uid()
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.salary_records r
      WHERE r.cycle_id = v_cycle_id
        AND r.staff_id IS NOT DISTINCT FROM c.staff_id
        AND r.support_staff_id IS NOT DISTINCT FROM c.support_staff_id
    )
    RETURNING 1
  ),
  synced AS (
    -- Catch up rows created before a base salary existed and still sitting
    -- at the generator's zero default, now that a real base is on file.
    UPDATE public.salary_records sr
    SET base_amount = c.base_amount
    FROM candidates c
    WHERE sr.cycle_id = v_cycle_id
      AND sr.base_amount = 0
      AND c.base_amount <> 0
      AND sr.staff_id IS NOT DISTINCT FROM c.staff_id
      AND sr.support_staff_id IS NOT DISTINCT FROM c.support_staff_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

NOTIFY pgrst, 'reload schema';
