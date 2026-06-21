-- ============================================================
-- Migration: Smart Board accounts (Phase 1)
--
-- A smart board is a shared login that lives in a homeroom (e.g.
-- "Grade 9 A") and is opened on the classroom's physical board for
-- most of the school day. It is provisioned by an admin from the
-- Homeroom Manager and gets its own dashboard-only experience.
--
-- profiles.role is a TEXT column guarded by a CHECK constraint (NOT
-- a Postgres enum), so we widen the constraint to admit 'smartboard'
-- exactly the way the 'driver' role was added. public.get_user_role()
-- returns the text directly and the role-sync trigger mirrors it into
-- auth.users — neither needs any change.
--
-- A smart board is NEVER a homeroom_member, so it is automatically
-- excluded from attendance mark sheets (which read homeroom_members)
-- and from student leaderboards (which filter role = 'student'). When
-- a homeroom is imported into a classroom the smart board is added as
-- a classroom_member with teacher-level access.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- 1. Allow the new 'smartboard' role on profiles.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'teacher', 'coordinator', 'principal', 'admin', 'driver', 'smartboard'));

-- 2. Link a homeroom to its smart board account (one board per homeroom).
--    ON DELETE SET NULL so removing the board account doesn't drop the homeroom.
ALTER TABLE public.homerooms
  ADD COLUMN IF NOT EXISTS smartboard_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homerooms_smartboard_id ON public.homerooms(smartboard_id);

-- 3. Customisable smart board banner (per homeroom). The board account edits
--    its own banner; the title shown on it defaults to the homeroom name.
ALTER TABLE public.homerooms
  ADD COLUMN IF NOT EXISTS smartboard_banner JSONB;

-- Reload PostgREST schema cache so the new columns/role are exposed.
NOTIFY pgrst, 'reload schema';
