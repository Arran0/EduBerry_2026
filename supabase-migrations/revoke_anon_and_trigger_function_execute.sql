-- SECURITY DEFINER functions in `public` were EXECUTE-able by anon (79 of them)
-- and by authenticated (109), including 16 trigger functions that are never
-- meant to be called directly at all. A SECURITY DEFINER function runs as its
-- owner, so every unnecessary grant is a standing offer to run owner-privileged
-- code — Supabase's anon_/authenticated_security_definer_function_executable
-- lints.
--
-- Two revocations, each chosen so nothing in the app loses access:
--
-- 1. Trigger functions: revoked from public, anon AND authenticated. Postgres
--    checks EXECUTE on a trigger function when the trigger is CREATEd, not when
--    it fires, so the triggers keep working — already demonstrated by
--    guard_profile_privileged_columns, which still blocks self-promotion despite
--    being revoked in an earlier migration.
--
-- 2. Every other SECURITY DEFINER function: revoked from public and anon only.
--    The two genuinely public pages (/login, /verify/[certNo]) make no direct
--    RPC calls, and the only thing anon reads is site_settings.
--
-- `authenticated` deliberately keeps EXECUTE on the non-trigger functions:
--    - 29 of them are referenced inside RLS policy expressions, which are
--      evaluated with the querying user's privileges — revoking would make
--      every policy that calls them fail closed;
--    - the rest are the app's actual RPC surface (get_monthly_member_stats,
--      staff_attendance_punch, record_app_open, generate_salary_cycle, ...),
--      which a signed-in user is supposed to call and which each perform their
--      own authorization checks internally.
--    The remaining lint on those is expected for an RPC-shaped API, not a defect.
--
-- anon also keeps EXECUTE on the policy-referenced helpers: anon holds Supabase's
-- default table-level SELECT grant on the public schema (RLS is what actually
-- denies it), so those policies still have to evaluate for an anon request to
-- return zero rows rather than a permission error.
--
-- Verified in a rolled-back transaction before applying: anon still reads all 32
-- non-sensitive site_settings rows, and as a signed-in student the announcements
-- feed, the unread badge and get_server_time all still execute.

DO $do$
DECLARE
  r      record;
  n_trig integer := 0;
  n_anon integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           p.prorettype = 'trigger'::regtype AS is_trigger,
           EXISTS (
             SELECT 1 FROM pg_policies pol
             WHERE pol.schemaname = 'public'
               AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, ''))
                   ~ ('\m' || p.proname || '\M')
           ) AS in_policy
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    IF r.is_trigger THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', r.sig);
      n_trig := n_trig + 1;
    ELSIF NOT r.in_policy THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', r.sig);
      n_anon := n_anon + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'trigger fns locked: %, anon revoked: %', n_trig, n_anon;
END
$do$;
