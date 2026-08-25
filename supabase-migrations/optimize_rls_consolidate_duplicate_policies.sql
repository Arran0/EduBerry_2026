-- ============================================================
-- Cost/performance optimization: consolidate duplicate permissive policies.
--
-- When multiple PERMISSIVE policies exist for the same (table, command),
-- Postgres evaluates ALL of them and OR's the results together — a row is
-- visible if it satisfies ANY of them. This merges every such group into a
-- single policy whose USING/WITH CHECK is the OR of the originals, which is
-- semantically IDENTICAL (same rows visible/writable) but removes N-1 policy
-- bodies the planner has to plan and evaluate per query.
--
-- Confirmed live before this migration: 29 (table, cmd) groups with >1
-- permissive policy, worst being leave_applications SELECT (6 policies) and
-- staff_attendance_records SELECT/INSERT/UPDATE (3-4 each).
--
-- Deliberately NOT handled here: tables where an `ALL` policy coexists with
-- a command-specific policy (e.g. profiles: ALL + SELECT + UPDATE). Folding
-- a SELECT-only condition into an ALL policy's USING clause would also
-- loosen UPDATE/DELETE row visibility on that table, since USING governs
-- SELECT+UPDATE+DELETE together — that requires splitting the ALL policy
-- into 4 explicit per-command policies first, which needs per-table review,
-- not a blind merge. Left as a follow-up.
-- ============================================================

DO $$
DECLARE
  grp record;
  pol record;
  merged_qual text;
  merged_wc text;
  first_policy text;
  n int := 0;
  is_first boolean;
BEGIN
  FOR grp IN
    SELECT tablename, cmd
    FROM pg_policies
    WHERE schemaname='public' AND permissive='PERMISSIVE'
    GROUP BY tablename, cmd
    HAVING count(*) > 1
  LOOP
    merged_qual := NULL;
    merged_wc := NULL;
    first_policy := NULL;
    is_first := true;

    FOR pol IN
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname='public' AND tablename=grp.tablename AND cmd=grp.cmd AND permissive='PERMISSIVE'
      ORDER BY policyname
    LOOP
      IF is_first THEN
        first_policy := pol.policyname;
        is_first := false;
      ELSE
        EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, 'public', grp.tablename);
      END IF;

      IF pol.qual IS NOT NULL THEN
        merged_qual := CASE WHEN merged_qual IS NULL THEN '(' || pol.qual || ')' ELSE merged_qual || ' OR (' || pol.qual || ')' END;
      END IF;
      IF pol.with_check IS NOT NULL THEN
        merged_wc := CASE WHEN merged_wc IS NULL THEN '(' || pol.with_check || ')' ELSE merged_wc || ' OR (' || pol.with_check || ')' END;
      END IF;
    END LOOP;

    IF merged_qual IS NOT NULL OR merged_wc IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I%s%s',
        first_policy, 'public', grp.tablename,
        CASE WHEN merged_qual IS NOT NULL THEN format(' USING (%s)', merged_qual) ELSE '' END,
        CASE WHEN merged_wc IS NOT NULL THEN format(' WITH CHECK (%s)', merged_wc) ELSE '' END
      );
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Consolidated % same-cmd policy groups', n;
END $$;

NOTIFY pgrst, 'reload schema';
