-- ============================================
-- FIX: Multiple Admins Support
-- ============================================
-- Run this in the Supabase SQL editor if you added a second admin
-- and the first admin's login stopped working.
--
-- Root cause: RLS policies check auth.jwt() user_metadata role claims,
-- but those claims are only set correctly when the role is synced from
-- the profiles table to auth.users.raw_user_meta_data.
-- This migration ensures all admin profiles are synced.

-- ── Step 1: Create / replace the role-sync trigger function ──────────────
CREATE OR REPLACE FUNCTION public.sync_role_to_auth_metadata()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{role}',
    to_jsonb(NEW.role)
  )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop + recreate trigger so it fires on any role change going forward
DROP TRIGGER IF EXISTS sync_role_to_auth ON public.profiles;
CREATE TRIGGER sync_role_to_auth
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_role_to_auth_metadata();

-- ── Step 2: Back-fill ALL existing admin users right now ─────────────────
-- This syncs the role field into raw_user_meta_data for every admin,
-- so their next JWT refresh will include the correct role claim.
UPDATE auth.users u
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb(p.role)
)
FROM public.profiles p
WHERE u.id = p.id
  AND p.role = 'admin';

-- ── Step 3: Also sync ALL roles (not just admin) to be safe ─────────────
UPDATE auth.users u
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb(p.role)
)
FROM public.profiles p
WHERE u.id = p.id;

-- ── Step 4: Ensure site_settings is writable by any authenticated admin ──
-- The USING (true) WITH CHECK (true) policy without TO authenticated may
-- not cover all cases. Replace it with an explicit authenticated policy.
DROP POLICY IF EXISTS "Admin write site_settings" ON site_settings;
CREATE POLICY "Admin write site_settings"
  ON site_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Step 5: Ensure profiles are readable by any authenticated user ────────
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✅ Multiple-admin fix applied. All admin roles synced to JWT metadata.';
  RAISE NOTICE '   Have all admin users sign out and sign back in for changes to take effect.';
END $$;
