-- Stop trusting auth.users.raw_user_meta_data for authorization.
--
-- Two separate holes, closed together:
--
-- 1. 88 policies across 27 tables branched on
--      ((( SELECT auth.jwt()) -> 'user_metadata') ->> 'role')
--    but user_metadata is writable by the end user — a single
--    supabase.auth.updateUser({ data: { role: 'admin' } }) from the browser
--    rewrites that claim and every one of those policies then reads 'admin'.
--    This is Supabase's `rls_references_user_metadata` lint (ERROR).
--
-- 2. profiles.role was the obvious alternative, but "Users can update own
--    profile" allowed UPDATE where id = auth.uid() with no column restriction,
--    and the sync_role_to_auth trigger copies profiles.role straight into
--    auth.users.raw_user_meta_data. So self-promotion worked through that path
--    too, and even backfilled the JWT.
--
-- Part A pins the privileged columns; Part B then moves every policy onto
-- profiles.role via get_user_role(), which Part A has made trustworthy.


-- ── Part A: privilege escalation guard on public.profiles ───────────────────
--
-- Every legitimate write to these columns goes through a server-side route using
-- the service-role key (src/app/api/admin/*), which this guard exempts. The only
-- client-side profile writes the app makes are avatar_url and full_name, both of
-- which stay editable.

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     jsonb;
  jwt_role   text;
  actor      uuid;
  actor_role text;
BEGIN
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;

  -- No JWT at all: migrations, psql, cron, server-side jobs. Not a browser.
  IF claims IS NULL THEN
    RETURN NEW;
  END IF;

  jwt_role := claims ->> 'role';

  -- The service-role key is only ever used from our own server routes.
  IF jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  actor := auth.uid();

  -- An admin acting through a normal session may still manage these columns.
  SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id = actor;
  IF actor_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Everyone else: privileged columns are pinned to their stored values.
  NEW.role              := OLD.role;
  NEW.email             := OLD.email;
  NEW.grade             := OLD.grade;
  NEW.section           := OLD.section;
  NEW.is_banned         := OLD.is_banned;
  NEW.banned_at         := OLD.banned_at;
  NEW.geofence_exempt   := OLD.geofence_exempt;
  NEW.is_non_teaching   := OLD.is_non_teaching;
  NEW.attendance_hidden := OLD.attendance_hidden;
  NEW.display_role      := OLD.display_role;

  RETURN NEW;
END;
$$;

-- Fires before the role-sync trigger, so a pinned role never reaches auth metadata.
DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_columns() FROM public, anon, authenticated;


-- ── Part B: move every policy off user_metadata ─────────────────────────────
--
-- All 126 occurrences shared one exact expression, so each affected policy is
-- rebuilt with it swapped for (SELECT public.get_user_role()) — a STABLE
-- SECURITY DEFINER read of profiles.role. Wrapping it in a scalar subquery keeps
-- it an InitPlan, evaluated once per query rather than once per row.
--
-- Only the role lookup changes; each policy's logic, command, roles and
-- permissive/restrictive kind are preserved exactly. Re-running is a no-op
-- because the loop only matches policies that still contain the old expression.

DO $do$
DECLARE
  r        record;
  old_expr constant text := '((( SELECT auth.jwt() AS jwt) -> ''user_metadata''::text) ->> ''role''::text)';
  new_expr constant text := '( SELECT public.get_user_role())';
  n        integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%user_metadata%'
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      r.policyname, r.schemaname, r.tablename,
      CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      r.cmd,
      array_to_string(r.roles, ', '),
      CASE WHEN r.qual IS NULL THEN ''
           ELSE ' USING (' || replace(r.qual, old_expr, new_expr) || ')' END,
      CASE WHEN r.with_check IS NULL THEN ''
           ELSE ' WITH CHECK (' || replace(r.with_check, old_expr, new_expr) || ')' END
    );

    n := n + 1;
  END LOOP;

  RAISE NOTICE 'rewrote % policies', n;
END
$do$;
