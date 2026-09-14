-- Two long-standing RLS hygiene problems across the payroll/salary/bank tables,
-- fixed together because both are a mechanical rewrite of the same policies.
--
-- 1. ROLE SCOPE. 31 tables (payroll_runs, payroll_run_lines, payroll_components,
--    driver_bank_accounts, every payroll_* ledger …) carried policies granted to
--    the `public` role rather than `authenticated`, so Postgres evaluated them
--    for anonymous requests too. No row ever leaked — every clause requires
--    get_user_role() = 'admin' or a match on auth.uid(), and an anon request has
--    neither — but it is work done on every anon request for a guaranteed-empty
--    result, and it leaves the tables one careless policy edit away from a real
--    hole. Scoped to `authenticated`, matching what salary_records,
--    staff_bank_accounts and staff_salary_base already do (and the same change
--    scope_non_working_day_policies_to_authenticated.sql made elsewhere).
--
-- 2. PER-ROW ROLE LOOKUP. Nine `FOR ALL` admin policies (payroll_exceptions,
--    payroll_run_events, payroll_scenarios, payroll_revisions,
--    payroll_calendar_members, payroll_policy_group_members,
--    payroll_structure_components, support_staff_salary_base,
--    support_staff_bank_accounts) called get_user_role() unwrapped. It is a
--    niladic STABLE function, so unwrapped Postgres re-evaluates it once PER ROW
--    instead of once per statement — Supabase's auth_rls_initplan lint. Wrapped
--    in a scalar subquery, which hoists it to a one-off InitPlan.
--
-- The rewrite is mechanical and behaviour-preserving: each policy is recreated
-- with its own qual/with_check text verbatim (only the get_user_role() call
-- rewritten), its own command, and its own permissive/restrictive kind. No
-- clause is merged across commands and no policy is dropped without being
-- recreated, so nothing widens.
--
-- service_role is unaffected: it holds BYPASSRLS, so the server routes that use
-- the service key never evaluate these policies at all.
--
-- Verified before and after against three personas (admin, an ordinary driver,
-- and no claims at all), with the DDL first dry-run inside a rolled-back
-- transaction: visible row counts on driver_bank_accounts,
-- support_staff_salary_base, support_staff_bank_accounts, payroll_components,
-- payroll_structures, payroll_employee_structures and payroll_tax_declarations
-- are identical before and after for every persona (admin 5/28/18/30, driver
-- 0/0/0/30, anon 0/0/0). Afterwards: 0 policies remain on these tables scoped to
-- `public`, and 0 still call get_user_role() unwrapped.

DO $do$
DECLARE
  r        record;
  v_qual   text;
  v_check  text;
  v_sql    text;
  n        integer := 0;
BEGIN
  FOR r IN
    SELECT p.schemaname, p.tablename, p.policyname, p.permissive, p.cmd,
           p.roles::text AS roles, p.qual, p.with_check
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (p.tablename LIKE 'payroll%' OR p.tablename LIKE '%salary%'
           OR p.tablename LIKE '%bank_account%' OR p.tablename LIKE 'support_staff%'
           OR p.tablename LIKE 'driver_payroll%')
      AND (
        p.roles::text = '{public}'
        OR (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) LIKE '%(get_user_role()%'
      )
    ORDER BY p.tablename, p.policyname
  LOOP
    -- Hoist the niladic STABLE helper into a scalar subquery so Postgres
    -- evaluates it once per statement instead of once per row. Only touch
    -- occurrences that are not already wrapped.
    v_qual  := r.qual;
    v_check := r.with_check;
    IF v_qual IS NOT NULL AND v_qual NOT LIKE '%SELECT get_user_role%' THEN
      v_qual := replace(v_qual, 'get_user_role()', '( SELECT public.get_user_role())');
    END IF;
    IF v_check IS NOT NULL AND v_check NOT LIKE '%SELECT get_user_role%' THEN
      v_check := replace(v_check, 'get_user_role()', '( SELECT public.get_user_role())');
    END IF;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO authenticated',
                    r.policyname, r.schemaname, r.tablename,
                    CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                    r.cmd);
    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_qual);
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;
    EXECUTE v_sql;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'rebuilt % policies', n;
END
$do$;
