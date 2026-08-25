-- ============================================================
-- Cost/performance optimization: wrap bare auth.uid() / auth.jwt() /
-- get_user_role() calls inside RLS policies in a scalar subquery.
--
-- Postgres re-evaluates a bare STABLE function call once PER ROW scanned
-- under RLS. Wrapping it as `(select auth.uid())` lets the planner hoist it
-- into a one-time InitPlan instead, evaluated once per statement. This is
-- Supabase's documented #1 RLS performance fix. Confirmed live via
-- get_advisors (auth_rls_initplan lint) before this migration: 123 bare
-- auth.uid(), 75 bare auth.jwt(), 166 bare get_user_role() across every
-- policy in the public schema.
--
-- This script is idempotent: on a schema where every call is already
-- wrapped, the regexp_replace is a no-op and no ALTER POLICY is issued.
-- ============================================================

DO $$
DECLARE
  r record;
  new_qual text;
  new_wc text;
  clause text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual := r.qual;
    new_wc := r.with_check;

    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      new_qual := regexp_replace(new_qual, 'get_user_role\(\)', '(select get_user_role())', 'g');
    END IF;

    IF new_wc IS NOT NULL THEN
      new_wc := regexp_replace(new_wc, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_wc := regexp_replace(new_wc, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      new_wc := regexp_replace(new_wc, 'get_user_role\(\)', '(select get_user_role())', 'g');
    END IF;

    -- Only touch policies where something actually changed. Note: once
    -- already wrapped, Postgres redisplays the expression as
    -- `( SELECT auth.uid() AS uid)` (uppercase, aliased) — the regexes above
    -- match the lowercase bare form only, so a second run is a true no-op.
    IF (new_qual IS DISTINCT FROM r.qual) OR (new_wc IS DISTINCT FROM r.with_check) THEN
      clause := '';
      IF new_qual IS NOT NULL AND new_qual IS DISTINCT FROM r.qual THEN
        clause := clause || format(' USING (%s)', new_qual);
      END IF;
      IF new_wc IS NOT NULL AND new_wc IS DISTINCT FROM r.with_check THEN
        clause := clause || format(' WITH CHECK (%s)', new_wc);
      END IF;
      EXECUTE format('ALTER POLICY %I ON %I.%I%s', r.policyname, r.schemaname, r.tablename, clause);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Rewrote % policies', n;
END $$;

NOTIFY pgrst, 'reload schema';
