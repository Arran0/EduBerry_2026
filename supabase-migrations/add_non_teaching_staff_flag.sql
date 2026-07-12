-- ============================================================
-- Migration: "Non-Teaching" staff display flag
--
-- Non-teaching staff (e.g. office staff, librarians, lab assistants)
-- need the exact same app access and permissions as teachers — every
-- RLS policy, route guard, and role-hierarchy check in the app keys
-- off profiles.role, and there are ~130 places across ~30 SQL files
-- that already special-case 'teacher'. Rather than introducing a new
-- literal role value and updating every one of those checks (high risk
-- of missing one and silently locking non-teaching staff out of a
-- feature), non-teaching accounts are stored as role = 'teacher' and
-- flagged with this boolean. The flag is purely cosmetic — it only
-- changes what the app displays ("Non-Teaching" instead of "Teacher");
-- it grants no different permissions than a regular teacher account.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_non_teaching BOOLEAN NOT NULL DEFAULT false;

-- Reload PostgREST schema cache so the new column is exposed.
NOTIFY pgrst, 'reload schema';
