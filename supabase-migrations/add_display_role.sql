-- ============================================================
-- Migration: Display role
--
-- Admins can now set a free-text "display role" per profile (e.g. "Head of
-- Department", "Sports Coordinator") that is shown everywhere the app shows
-- a person's role, without touching the underlying `role` column that every
-- RLS policy and permission check keys off. When left blank, the app falls
-- back to the standard label for the account's actual role (see
-- getDisplayRole in src/lib/supabase.ts).
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_role TEXT;

-- Reload PostgREST schema cache so the new column is exposed.
NOTIFY pgrst, 'reload schema';
