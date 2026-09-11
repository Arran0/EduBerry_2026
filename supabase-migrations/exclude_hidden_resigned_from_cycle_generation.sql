-- ============================================================
-- Migration: exclude resigned/banned staff and hidden salary members from
-- generate_salary_cycle's candidate roster.
--
-- generate_salary_cycle (see fix_salary_cycle_base_sync.sql) inserted a
-- salary_records row for every profile with an eligible role and every
-- active support_staff row, with no check against profiles.is_banned or the
-- salary_hidden_members list in site_settings. The app layer already filters
-- both out of an OPEN cycle's sheet (src/app/more/salary/manage/[cycleId]/
-- page.tsx's load()), but this function re-inserts a fresh row for them on
-- every call — which runs on every load of an open cycle — so the row keeps
-- coming back even after an admin clears it, and it resurfaces the moment
-- the cycle is locked (a closed cycle shows every record it has, since it is
-- meant to be history). The fix belongs here, at the source: never create
-- the row in the first place.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_salary_cycle(p_month smallint, p_year smallint)
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

  INSERT INTO public.salary_cycles (period_month, period_year, created_by)
  VALUES (p_month, p_year, auth.uid())
  ON CONFLICT (period_year, period_month) DO UPDATE SET period_month = EXCLUDED.period_month
  RETURNING id INTO v_cycle_id;

  IF (SELECT status FROM public.salary_cycles WHERE id = v_cycle_id) = 'closed' THEN
    RETURN QUERY SELECT v_cycle_id, 0;
    RETURN;
  END IF;

  WITH hidden AS (
    SELECT (jsonb_array_elements_text(value->'ids'))::uuid AS id
    FROM public.site_settings
    WHERE key = 'salary_hidden_members'
  ),
  candidates AS (
    SELECT p.id AS staff_id, NULL::uuid AS support_staff_id,
           COALESCE(sb.base_amount, db.base_amount, 0) AS base_amount
    FROM public.profiles p
    LEFT JOIN public.staff_salary_base   sb ON sb.staff_id  = p.id
    LEFT JOIN public.driver_payroll_base db ON db.driver_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'admin', 'driver')
      AND p.is_banned = false
      AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = p.id)
      AND (sb.id IS NULL OR sb.active = true)
      AND (db.id IS NULL OR db.active = true)

    UNION ALL

    SELECT NULL::uuid AS staff_id, s.id AS support_staff_id,
           COALESCE(ssb.base_amount, 0) AS base_amount
    FROM public.support_staff s
    LEFT JOIN public.support_staff_salary_base ssb ON ssb.support_staff_id = s.id
    WHERE s.is_active = true
      AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = s.id)
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
$function$;
