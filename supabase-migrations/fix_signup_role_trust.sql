-- Stop sign-up from choosing its own role.
--
-- fix_rls_stop_trusting_user_metadata.sql pinned the privileged profile
-- columns on UPDATE, but the INSERT side was still open:
--
-- 1. handle_new_user() copied raw_user_meta_data->>'role' into the new
--    profile. That metadata is whatever the caller passed to
--    supabase.auth.signUp({ options: { data: { role: 'admin' } } }), and the
--    anon key that allows that call ships in every browser bundle. If public
--    sign-ups are enabled on the project, anyone could create an admin.
--
-- 2. "Enable insert for authenticated users only" only checks id = auth.uid(),
--    so a fresh session could also INSERT its own profile with any role.
--
-- The trigger cannot tell an admin-created account from a self sign-up (GoTrue
-- inserts into auth.users without request.jwt.claims in both cases), so it now
-- always creates a 'student'. Every admin path (create-user, bulk-import,
-- create-smartboard) already upserts the real role with the service role right
-- after creating the account, and now fails loudly if that write does not land.
--
-- Before applying, compare with the live definition in case it has drifted:
--   select pg_get_functiondef('public.handle_new_user'::regproc);
-- Also turn off Authentication → Sign In / Providers → "Allow new users to sign
-- up" in the dashboard: every account in this app is admin-created or invited.

-- ── Part A: new auth users always start as a student ────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    lower(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

-- ── Part B: browser sessions can only insert an unprivileged profile ────────
--
-- Mirrors guard_profile_privileged_columns(): no JWT (trigger above, migrations,
-- cron) and the service role pass through untouched; an admin session may set
-- anything; everyone else gets the defaults.

CREATE OR REPLACE FUNCTION public.guard_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     jsonb;
  actor_role text;
BEGIN
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;

  IF claims IS NULL OR claims ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id = auth.uid();
  IF actor_role = 'admin' THEN
    RETURN NEW;
  END IF;

  NEW.role              := 'student';
  NEW.grade             := NULL;
  NEW.section           := NULL;
  NEW.is_banned         := false;
  NEW.banned_at         := NULL;
  NEW.geofence_exempt   := false;
  NEW.is_non_teaching   := false;
  NEW.attendance_hidden := false;
  NEW.display_role      := NULL;

  RETURN NEW;
END;
$$;

-- Fires before the role-sync trigger, so a forced role is what reaches auth metadata.
DROP TRIGGER IF EXISTS guard_profile_insert ON public.profiles;
CREATE TRIGGER guard_profile_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_insert();

REVOKE EXECUTE ON FUNCTION public.guard_profile_insert() FROM public, anon, authenticated;
