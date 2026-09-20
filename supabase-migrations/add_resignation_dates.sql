-- ============================================================
-- Migration: Resignation dates
--
-- The Staff Profile Manager marks a resigned staff/driver with
-- profiles.is_banned and a resigned support staff member with
-- support_staff.is_active = false, but neither ever recorded *when* — so the
-- admin UI could show that someone had resigned, never since when. This adds
-- one timestamp column to each, set the moment the toggle happens (see
-- src/app/api/admin/toggle-ban/route.ts and setSupportStaffActive in
-- src/lib/supportStaff.ts) and cleared when they're restored.
--
-- Existing resigned rows get NULL here — there is no reliable way to
-- reconstruct when a past resignation happened, so the UI simply omits a
-- date for those rather than guessing one.
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

ALTER TABLE public.support_staff
  ADD COLUMN IF NOT EXISTS resigned_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
