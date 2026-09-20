-- The Pay Cycles list shows "paid / total" beside each cycle. Both tallies were
-- computed in the browser by SELECTing EVERY salary_records row (and every
-- driver_payroll_records row) ever written — all of them, with a profile join
-- each — and counting them in a loop. The list itself renders one row per
-- cycle, so the payload grew with the whole history of the payroll while the
-- rendered output stayed the size of the cycle list. A school three years in
-- downloads tens of thousands of rows to print a couple of dozen fractions.
--
-- These two functions do the counting in Postgres and return one row per cycle.
--
-- SECURITY INVOKER deliberately: the caller's own RLS still applies, exactly as
-- it did for the client-side query being replaced, so this adds no new read
-- surface. An admin sees every cycle's tally; anyone else sees only what their
-- own policies already let them read.
--
-- The roster rules are ported verbatim from recordPersonLeft/fetchCycleTallies
-- in src/lib/salary.ts and fetchDriverCycleTallies in src/lib/driverSalary.ts:
--
--   • An OPEN cycle drops rows for whoever has since resigned (banned),
--     left (support staff marked inactive), been deleted outright (both person
--     ids null), or been hidden from the salary app in settings.
--   • A CLOSED cycle is history and keeps every row it had at lock time,
--     whatever has happened to the person since.
--   • The legacy driver-only cycles have no closed-cycle exception, matching
--     what fetchDriverCycleTallies did.

CREATE OR REPLACE FUNCTION public.salary_cycle_tallies()
 RETURNS TABLE(cycle_id uuid, total integer, paid integer)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH hidden AS (
    SELECT (jsonb_array_elements_text(value->'ids'))::uuid AS id
    FROM public.site_settings
    WHERE key = 'salary_hidden_members'
  )
  SELECT r.cycle_id,
         count(*)::int,
         count(*) FILTER (WHERE r.status = 'paid')::int
  FROM public.salary_records r
  JOIN public.salary_cycles c ON c.id = r.cycle_id
  LEFT JOIN public.profiles p ON p.id = r.staff_id
  LEFT JOIN public.support_staff s ON s.id = r.support_staff_id
  WHERE c.status = 'closed'
     OR (
          NOT (CASE
                 WHEN p.id IS NOT NULL THEN p.is_banned
                 WHEN s.id IS NOT NULL THEN NOT s.is_active
                 ELSE (r.staff_id IS NULL AND r.support_staff_id IS NULL)
               END)
          AND NOT EXISTS (
            SELECT 1 FROM hidden h
            WHERE h.id = coalesce(r.staff_id, r.support_staff_id)
          )
        )
  GROUP BY r.cycle_id;
$function$;

CREATE OR REPLACE FUNCTION public.driver_cycle_tallies()
 RETURNS TABLE(cycle_id uuid, total integer, paid integer)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH hidden AS (
    SELECT (jsonb_array_elements_text(value->'ids'))::uuid AS id
    FROM public.site_settings
    WHERE key = 'salary_hidden_members'
  )
  SELECT r.cycle_id,
         count(*)::int,
         count(*) FILTER (WHERE r.status = 'paid')::int
  FROM public.driver_payroll_records r
  LEFT JOIN public.profiles p ON p.id = r.driver_id
  WHERE coalesce(p.is_banned, false) = false
    AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = r.driver_id)
  GROUP BY r.cycle_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.salary_cycle_tallies() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.driver_cycle_tallies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salary_cycle_tallies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_cycle_tallies() TO authenticated;
