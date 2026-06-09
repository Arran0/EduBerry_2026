-- ============================================================
-- Migration: Homeroom Academic Year & Expiry
-- Adds academic_year and expiry_date columns to homerooms,
-- a unique index per grade/section/year, and a default
-- admin_settings entry for customisable expiry dates.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── New columns ──────────────────────────────────────────────

ALTER TABLE public.homerooms
  ADD COLUMN IF NOT EXISTS academic_year TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- ── Unique: one auto-homeroom per grade+section+year ─────────
-- NULLs are distinct in PostgreSQL, so manually-created homerooms
-- without academic_year can still coexist freely.

CREATE UNIQUE INDEX IF NOT EXISTS idx_homerooms_grade_section_ay
  ON public.homerooms (grade, section, academic_year)
  WHERE grade IS NOT NULL
    AND section IS NOT NULL
    AND academic_year IS NOT NULL;

-- ── Admin-configurable expiry dates ──────────────────────────
-- Stored as a JSON map: { "2026-27": "2027-05-31", ... }
-- Admins can update this key to override the default (May 31 of end year).

INSERT INTO public.admin_settings (key, value)
  VALUES (
    'homeroom_expiry_dates',
    '{"2026-27": "2027-05-31", "2027-28": "2028-05-31", "2028-29": "2029-05-31"}'
  )
  ON CONFLICT (key) DO NOTHING;
