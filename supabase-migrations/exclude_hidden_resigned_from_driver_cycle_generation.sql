-- ============================================================
-- Migration: exclude resigned/banned drivers and hidden salary members from
-- generate_driver_payroll_cycle's candidate roster. Companion to
-- exclude_hidden_resigned_from_cycle_generation.sql (same fix for the staff
-- generator) — see that migration's header for the full rationale.
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_driver_payroll_cycle(p_month smallint, p_year smallint)
 RETURNS TABLE(cycle_id uuid, created_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle_id UUID;
  v_created INT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  INSERT INTO public.driver_payroll_cycles (period_month, period_year, created_by)
  VALUES (p_month, p_year, auth.uid())
  ON CONFLICT (period_year, period_month) DO UPDATE SET period_month = EXCLUDED.period_month
  RETURNING id INTO v_cycle_id;

  WITH hidden AS (
    SELECT (jsonb_array_elements_text(value->'ids'))::uuid AS id
    FROM public.site_settings
    WHERE key = 'salary_hidden_members'
  ),
  inserted AS (
    INSERT INTO public.driver_payroll_records (cycle_id, driver_id, base_amount, created_by)
    SELECT v_cycle_id, p.id, COALESCE(b.base_amount, 0), auth.uid()
    FROM public.profiles p
    LEFT JOIN public.driver_payroll_base b ON b.driver_id = p.id
    WHERE p.role = 'driver'
      AND p.is_banned = false
      AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = p.id)
      AND (b.id IS NULL OR b.active = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.driver_payroll_records r
        WHERE r.cycle_id = v_cycle_id AND r.driver_id = p.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$function$;
