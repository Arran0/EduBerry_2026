-- ============================================================
-- Cost/performance optimization: scope every RLS policy to `authenticated`.
--
-- Confirmed live: 259 of 327 policies had no TO clause, defaulting to
-- PUBLIC — meaning they are planned and evaluated for the `anon` role on
-- every unauthenticated request too. The app has no legitimate anon-role
-- data path: every pre-auth read (certificate verification, the login page)
-- goes through a service-role API route, never the anon-key browser client
-- directly against a table. Confirmed by inspecting
-- src/app/api/certificates/verify/[certNo]/route.ts and src/app/login/page.tsx
-- before running this.
--
-- Idempotent: policies already scoped to `authenticated` (or any non-public
-- role) are left untouched.
-- ============================================================

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND roles::text = '{public}'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Rescoped % policies to authenticated', n;
END $$;

NOTIFY pgrst, 'reload schema';
