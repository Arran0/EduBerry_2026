-- ============================================================
-- Migration: Add 'driver' role
-- Allows the new bus-driver user role on profiles. profiles.role
-- is a TEXT column guarded by a CHECK constraint (NOT a Postgres
-- enum), so we just widen the constraint. public.get_user_role()
-- returns the text directly and the role-sync trigger mirrors it
-- into auth.users — neither needs any change.
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'teacher', 'coordinator', 'principal', 'admin', 'driver'));

NOTIFY pgrst, 'reload schema';
