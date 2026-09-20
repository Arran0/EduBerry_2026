-- payroll_verify_lock() recomputes a locked run's integrity hash and compares it
-- to the one stored at lock time. Every other payroll RPC that reaches across
-- rows this way (payroll_lock_run, generate_salary_cycle,
-- generate_driver_payroll_cycle) opens with the same admin check; this one had
-- none, so — being SECURITY DEFINER, and therefore running as its owner with
-- payroll_runs' and payroll_run_lines' RLS bypassed — ANY signed-in user could
-- call it for ANY run id and learn whether that run's figures had been tampered
-- with, plus both hashes. Payroll-integrity state is admin business.
--
-- The function has no callers in the app (grep over src/ returns nothing), so
-- adding the guard changes no existing flow; it closes the RPC surface before
-- the audit screen that will use it is written.
--
-- STABLE is kept: the function still only reads.

CREATE OR REPLACE FUNCTION public.payroll_verify_lock(p_run uuid)
 RETURNS TABLE(stored_hash text, computed_hash text, intact boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stored TEXT; v_computed TEXT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT locked_hash INTO v_stored FROM public.payroll_runs WHERE id = p_run;
  SELECT encode(digest(string_agg(t, '|' ORDER BY t), 'sha256'), 'hex') INTO v_computed
  FROM (
    SELECT employee_id::TEXT || ':' || gross_earnings::TEXT || ':' ||
           total_deductions::TEXT || ':' || net_pay::TEXT AS t
    FROM public.payroll_run_lines WHERE run_id = p_run
  ) s;
  RETURN QUERY SELECT v_stored, v_computed, (v_stored IS NOT NULL AND v_stored = v_computed);
END $function$;

-- Keep the grant shape the rest of the SECURITY DEFINER surface uses — anon
-- never reaches it, authenticated does and is filtered by the guard above.
-- See revoke_anon_and_trigger_function_execute.sql for why anon is excluded.
REVOKE EXECUTE ON FUNCTION public.payroll_verify_lock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_verify_lock(uuid) TO authenticated;
